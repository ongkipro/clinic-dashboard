// T-107 (PR-33, R3) slice 1 — the synthetic K1–K19 fixture (Panel 2, 2026-11-19). One synthetic tenant, branches A and B, one month
// (2026-10, Asia/Jakarta). Facts are taken from the signed money fixture (docs/spec/fixtures/money-scenarios.md, DEC-080: prices, costs,
// commission figures) plus a small synthetic visit / plan / lead / appointment / roster / stock / target set where the money fixture says
// nothing. Expected values are derived by the published formulas of docs/spec/02-PRD.md Appendix A, computed here by a plain reference
// function over the facts — the readers T-107 builds later must equal these numbers on the same facts loaded through the real writers.
//
// Markers (not sign-offs):
//   OWNER-SIGNOFF — a finance interpretation the Appendix A text does not settle; drafted here, the finance owner signs it (like DEC-080).
//   AMBIGUITY     — a material ambiguity in a formula row; the exact row is named, the value is drafted on the stated reading, the other
//                   K rows continue.
// Nothing here claims a sign-off. No reader, migration or shared file is part of this slice.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES, type Role } from "../../src/auth/policy";
import { LEVEL3_ROLES } from "../../src/modules/org/schema";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { issueKasirInvoice, openKasirInvoice, receivePayment, requestVoid } from "../../src/modules/cashier/kasir/kasir";
import { payRefund, requestRefund } from "../../src/modules/cashier/receivables/receivables";
import { chargeConsultationFee } from "../../src/modules/cashier/consultation/consultation";
import { createLead, setLeadStage } from "../../src/modules/crm/leads/leads";
import { createDepot } from "../../src/modules/inventory/depots/depots";
import { consumeMaterials, issueMaterials, requestMaterials, setItemClass } from "../../src/modules/inventory/materials/materials";
import { receiveCosted } from "../../src/modules/inventory/costing/costing";
import { getCount, recordCount, saveItem, setLevel, startCount, submitCount } from "../../src/modules/inventory/stock";
import { runPackageExpiryScan } from "../../src/modules/packages/expiry";
import { closeVisit } from "../../src/modules/visits/visits";
import { attributeSale, createRule, decideRuleVersion } from "../../src/modules/commission/commission";
import { listTargets, myTarget, setStaffTarget } from "../../src/modules/commission/targets/targets";
import { changeSetting } from "../../src/modules/settings/settings";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { publish } from "../../src/modules/catalog/catalog";
import { captureConsent, consentText } from "../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../src/modules/clinical/records/records";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { cancelPackage, interruptedToBalance, reserveSession, setPackageContents, topUpBalance } from "../../src/modules/packages/packages";
import { createRequest, decideRequest } from "../../src/modules/clinical/requests/requests";
import { releaseAddition } from "../../src/modules/cashier/additions/additions";
import { confirmSelection } from "../../src/modules/pharmacy/pharmacy";
import { SIGNATURE_HEADER } from "../../src/modules/payments/mock";
import { createCharge, enableMockPort, receiveMockWebhook, simulate } from "../../src/modules/payments/payments";
import { finishTreatment, startTreatment } from "../../src/modules/treatment/treatment";
import { createHarness, type Harness, testPool } from "../rls/harness";
import { kpi, roleHome } from "../../src/modules/reporting/dashboards/dashboards";
import { CommandError } from "../../src/lib/command";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { RoleHomeView } from "../../src/app/(app)/ringkasan/peran/role-home-view";
import type { K14Extra, MarketingHome } from "../../src/modules/reporting/dashboards/dashboards";

// ── facts (synthetic; money facts from the signed scenarios) ───────────────────────────────────────────────────────────────────────
type Branch = "A" | "B";
type Method = "cash" | "transfer" | "qris" | "edc" | "balance";
type Payment = { id: string; branch: Branch; day: string; amount: number; method: Method; simulated?: boolean };
type CashRefund = { id: string; branch: Branch; day: string; amount: number }; // a refund paid in cash (BILL-25 exception)
type Sale = { id: string; branch: Branch; day: string; kind: "line" | "package"; value: number; vat: number; visit?: string; voided?: boolean;
  closingBc?: string; consultation?: boolean };
type SaleReduction = { sale: string; branch: Branch; day: string; amount: number; why: "refund" | "cancelled_unpaid_package" };
type Performance = { id: string; branch: Branch; day: string; kind: "treatment" | "session" | "product" | "consultation"; value: number;
  materialCost: number; productCost: number; performerCommission: number; standardConsumption?: boolean };
type Receivable = { id: string; branch: Branch; openedDay: string; amount: number; collected: number; writtenOff: number };
type UnpaidClosedLine = { id: string; branch: Branch; issuedDay: string; closedDay: string; amount: number };
type Liability = { branch: Branch; kind: "paid_not_delivered" | "packages" | "balance" | "booking_dp"; amount: number; expiresWithin30?: boolean };
type ExpiryToBalance = { package: string; branch: Branch; day: string; amount: number };
type Visit = { id: string; patient: string; branch: Branch; day: string; consultation: boolean; qualifyingPurchase: boolean; treatment: boolean;
  productSale: boolean; completed: boolean };
type PlanItem = { visit: string; branch: Branch; recommendedDay: string; value: number; selectedDay?: string };
type Appointment = { id: string; branch: Branch; day: string; state: "arrived" | "no_show" | "cancelled_late" | "cancelled_early" | "booked" };
type Lead = { id: string; branch: Branch; source: string; assignee: string; createdAt: string; firstResponseAt?: string; inOpeningHours: boolean;
  booked: boolean; arrived: boolean; paid: boolean };
type Span = [string, string]; // local "HH:MM" start, end (same day)
type Roster = { staff: string; branch: Branch; day: string; work: Span[]; breaks: Span[]; booked: Span[]; executed: Span[] };
type StockItem = { item: string; branch: Branch; onHand: number; minQty: number; batchesExpiring30: number; countVariance: number };
type Commission = { staff: string; role: string; branch: Branch; entitlement: number; adjustment: number; state: "accrued" | "approved" | "paid" };
type Target = { bc: string; branch: Branch; month: string; target: number };

const MONTH = { from: "2026-10-01", to: "2026-10-31" };
const inMonth = (d: string) => d >= MONTH.from && d <= MONTH.to;

const F = {
  // S1 (A, cash 555,000, handed: serum 333,000 cost 150,000, sunscreen 222,000 cost 90,000), S2 (A, QRIS 1,500,000, counted, materials
  // 120,000, performer 50,000), S3a (A, EDC 400,000, counted, performer 50,000), S4a (A, cash consultation 150,000), S11 (package 3,000,000
  // cash at A; one session 600,000 counted at B, performer 50,000 at B), S15b (the serum returned, cash refund exception 333,000 at A),
  // S8 (package 5,000,000 at A, 3,000,000 paid, 2 sessions counted earlier; expiry moves 1,000,000 to balance), S3b (receivable 400,000
  // at A, opened 2026-08-20, collected later — open at month end), S14 (receivable 400,000 written off), S18 (a simulated payment: never K1).
  payments: [
    { id: "S1", branch: "A", day: "2026-10-02", amount: 555_000, method: "cash" },
    { id: "S2", branch: "A", day: "2026-10-03", amount: 1_500_000, method: "qris" },
    { id: "S3a", branch: "A", day: "2026-10-04", amount: 400_000, method: "edc" },
    { id: "S4a", branch: "A", day: "2026-10-06", amount: 150_000, method: "cash" },
    { id: "S11", branch: "A", day: "2026-10-07", amount: 3_000_000, method: "cash" },
    { id: "S13", branch: "A", day: "2026-10-20", amount: 600_000, method: "balance" }, // balance usage is not new cash
    { id: "S18", branch: "A", day: "2026-10-21", amount: 1_500_000, method: "qris", simulated: true },
  ] as Payment[],
  cashRefunds: [{ id: "S15b", branch: "A", day: "2026-10-09", amount: 333_000 }] as CashRefund[],
  sales: [
    // closingBc: the closing BC of each sale (the money fixture: "every sale has a closing BC"; BC1's closing commission at 5 % is
    // 27,750 + 75,000 + 20,000 + 150,000 = S1 + S2 + S3a + S11, the commissions facts below); S4a is a consultation invoice (no consultation commission)
    { id: "S1-serum", branch: "A", day: "2026-10-02", kind: "line", value: 333_000, vat: 0, visit: "V1", closingBc: "BC1" },
    { id: "S1-sun", branch: "A", day: "2026-10-02", kind: "line", value: 222_000, vat: 0, visit: "V1", closingBc: "BC1" },
    { id: "S2", branch: "A", day: "2026-10-03", kind: "line", value: 1_500_000, vat: 0, visit: "V2", closingBc: "BC1" },
    { id: "S3a", branch: "A", day: "2026-10-04", kind: "line", value: 400_000, vat: 0, visit: "V2", closingBc: "BC1" },
    { id: "S4a", branch: "A", day: "2026-10-06", kind: "line", value: 150_000, vat: 0, visit: "V4", closingBc: "BC1", consultation: true },
    { id: "S11", branch: "A", day: "2026-10-07", kind: "package", value: 3_000_000, vat: 0, closingBc: "BC1" },
    { id: "S8", branch: "A", day: "2026-09-01", kind: "package", value: 5_000_000, vat: 0 }, // sold before the month
    { id: "VOID", branch: "A", day: "2026-10-08", kind: "line", value: 666_000, vat: 0, voided: true },
  ] as Sale[],
  saleReductions: [
    { sale: "S1-serum", branch: "A", day: "2026-10-09", amount: 333_000, why: "refund" },
    { sale: "S8", branch: "A", day: "2026-10-15", amount: 2_000_000, why: "cancelled_unpaid_package" },
  ] as SaleReduction[],
  performances: [
    { id: "S1-serum", branch: "A", day: "2026-10-02", kind: "product", value: 333_000, materialCost: 0, productCost: 150_000, performerCommission: 0 },
    { id: "S1-sun", branch: "A", day: "2026-10-02", kind: "product", value: 222_000, materialCost: 0, productCost: 90_000, performerCommission: 0 },
    { id: "S2", branch: "A", day: "2026-10-03", kind: "treatment", value: 1_500_000, materialCost: 120_000, productCost: 0, performerCommission: 50_000 },
    { id: "S3a", branch: "A", day: "2026-10-04", kind: "treatment", value: 400_000, materialCost: 0, productCost: 0, performerCommission: 50_000, standardConsumption: true },
    { id: "S4a", branch: "A", day: "2026-10-06", kind: "consultation", value: 150_000, materialCost: 0, productCost: 0, performerCommission: 0 },
    { id: "S11-s1", branch: "B", day: "2026-10-10", kind: "session", value: 600_000, materialCost: 0, productCost: 0, performerCommission: 50_000 },
  ] as Performance[],
  receivables: [
    { id: "S3b", branch: "A", openedDay: "2026-08-20", amount: 400_000, collected: 0, writtenOff: 0 },
    { id: "S14", branch: "A", openedDay: "2026-07-01", amount: 400_000, collected: 0, writtenOff: 400_000 },
  ] as Receivable[],
  // invoice issued 2026-09-10, visit closed 2026-10-25: more than 30 days apart, so the issue-day and close-day readings bucket differently
  unpaidClosedLines: [{ id: "L-closed", branch: "B", issuedDay: "2026-09-10", closedDay: "2026-10-25", amount: 222_000 }] as UnpaidClosedLine[],
  liabilities: [
    { branch: "A", kind: "packages", amount: 2_400_000 }, // S11: 3,000,000 − the session counted at B (600,000), liability arose at A
    { branch: "A", kind: "packages", amount: 300_000, expiresWithin30: true },
    { branch: "A", kind: "balance", amount: 1_000_000 }, // S8 expiry
    { branch: "A", kind: "booking_dp", amount: 200_000 }, // S6 held
    { branch: "A", kind: "paid_not_delivered", amount: 0 },
  ] as Liability[],
  expiries: [{ package: "S8", branch: "A", day: "2026-10-15", amount: 1_000_000 }] as ExpiryToBalance[],
  visits: [
    { id: "V1", patient: "P1", branch: "A", day: "2026-10-02", consultation: false, qualifyingPurchase: true, treatment: false, productSale: true, completed: true },
    { id: "V2", patient: "P2", branch: "A", day: "2026-10-03", consultation: false, qualifyingPurchase: true, treatment: true, productSale: false, completed: true },
    { id: "V4", patient: "P3", branch: "A", day: "2026-10-06", consultation: true, qualifyingPurchase: false, treatment: false, productSale: false, completed: true },
    { id: "V5", patient: "P4", branch: "A", day: "2026-10-11", consultation: true, qualifyingPurchase: true, treatment: true, productSale: true, completed: true },
    { id: "V6", patient: "P2", branch: "A", day: "2026-10-24", consultation: false, qualifyingPurchase: true, treatment: true, productSale: true, completed: true },
    { id: "V7", patient: "P5", branch: "B", day: "2026-10-10", consultation: false, qualifyingPurchase: true, treatment: true, productSale: false, completed: true },
    { id: "V0", patient: "P5", branch: "A", day: "2026-06-01", consultation: true, qualifyingPurchase: false, treatment: false, productSale: false, completed: true },
  ] as Visit[],
  plans: [
    { visit: "V5", branch: "A", recommendedDay: "2026-10-11", value: 1_500_000, selectedDay: "2026-10-11" },
    { visit: "V5", branch: "A", recommendedDay: "2026-10-11", value: 666_000, selectedDay: "2026-11-20" },
    { visit: "V5", branch: "A", recommendedDay: "2026-10-11", value: 400_000 },
  ] as PlanItem[],
  appointments: [
    { id: "AP1", branch: "A", day: "2026-10-03", state: "arrived" }, { id: "AP2", branch: "A", day: "2026-10-04", state: "no_show" },
    { id: "AP3", branch: "A", day: "2026-10-05", state: "cancelled_late" }, { id: "AP4", branch: "A", day: "2026-10-06", state: "cancelled_early" },
    { id: "AP5", branch: "A", day: "2026-10-07", state: "arrived" }, { id: "AP6", branch: "B", day: "2026-10-10", state: "arrived" },
  ] as Appointment[],
  leads: [
    { id: "L1", branch: "A", source: "instagram", assignee: "CS1", createdAt: "2026-10-01T09:00", firstResponseAt: "2026-10-01T09:05", inOpeningHours: true, booked: true, arrived: true, paid: true },
    { id: "L2", branch: "A", source: "instagram", assignee: "CS1", createdAt: "2026-10-02T10:00", firstResponseAt: "2026-10-02T10:20", inOpeningHours: true, booked: true, arrived: false, paid: false },
    { id: "L3", branch: "A", source: "google", assignee: "CS2", createdAt: "2026-10-03T11:00", firstResponseAt: "2026-10-03T11:10", inOpeningHours: true, booked: false, arrived: false, paid: false },
    { id: "L4", branch: "A", source: "google", assignee: "CS2", createdAt: "2026-10-03T22:00", firstResponseAt: "2026-10-04T08:30", inOpeningHours: false, booked: false, arrived: false, paid: false },
  ] as Lead[],
  rosters: [
    // booked 300 / executed 240 and 120 / 180 minutes as before, now as intervals that overlap partly (so union ≠ max, ≠ sum)
    { staff: "D1", branch: "A", day: "2026-10-03", work: [["09:00", "17:00"]], breaks: [["12:00", "13:00"]],
      booked: [["09:00", "11:00"], ["14:00", "17:00"]], executed: [["10:30", "12:00"], ["14:30", "17:00"]] },
    { staff: "D1", branch: "A", day: "2026-10-04", work: [["09:00", "17:00"]], breaks: [["12:00", "13:00"]],
      booked: [["09:00", "11:00"]], executed: [["10:00", "12:00"], ["13:00", "14:00"]] },
  ] as Roster[],
  stock: [
    { item: "serum", branch: "A", onHand: 3, minQty: 5, batchesExpiring30: 1, countVariance: 0 },
    { item: "sunscreen", branch: "A", onHand: 10, minQty: 5, batchesExpiring30: 0, countVariance: -2 },
    { item: "serum", branch: "B", onHand: 6, minQty: 5, batchesExpiring30: 0, countVariance: 0 },
  ] as StockItem[],
  commissions: [ // S1, S2, S3a, S11 figures from the signed fixture (non-PKP), with the S15 adjustment
    { staff: "BC1", role: "closing_bc", branch: "A", entitlement: 27_750 + 75_000 + 20_000 + 150_000, adjustment: -16_650, state: "accrued" },
    { staff: "BC2", role: "guiding_bc", branch: "A", entitlement: 30_000 + 60_000, adjustment: 0, state: "approved" },
    { staff: "R1", role: "registrar", branch: "A", entitlement: 5_550 + 15_000, adjustment: 0, state: "accrued" },
    { staff: "D1", role: "performer", branch: "A", entitlement: 50_000 + 50_000, adjustment: 0, state: "paid" },
    { staff: "D2", role: "performer", branch: "B", entitlement: 50_000, adjustment: 0, state: "accrued" },
  ] as Commission[],
  targets: [
    { bc: "BC1", branch: "A", month: "2026-10", target: 6_000_000 },
    { bc: "BC3", branch: "B", month: "2026-10", target: 2_000_000 },
  ] as Target[],
};

// ── reference derivations (Appendix A text, one function per K) ────────────────────────────────────────────────────────────────────
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const byBranch = <T extends { branch: Branch }>(xs: T[], f: (x: T) => number) =>
  ({ A: sum(xs.filter((x) => x.branch === "A").map(f)), B: sum(xs.filter((x) => x.branch === "B").map(f)) });
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// K1 — payments received − cash refunds, by payment date; balance usage is not new cash; a simulated payment never (BILL-29).
const K1 = () => {
  const pay = F.payments.filter((p) => inMonth(p.day) && p.method !== "balance" && !p.simulated);
  const ref = F.cashRefunds.filter((r) => inMonth(r.day));
  const A = sum(pay.filter((p) => p.branch === "A").map((p) => p.amount)) - sum(ref.filter((r) => r.branch === "A").map((r) => r.amount));
  const B = sum(pay.filter((p) => p.branch === "B").map((p) => p.amount)) - sum(ref.filter((r) => r.branch === "B").map((r) => r.amount));
  const byMethod: Record<string, number> = {};
  for (const p of pay) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
  return { A, B, total: A + B, byMethod };
};
// K2 — treatments counted + products handed over + consultation fees charged, by performance date, excl. VAT; executing branch.
// Package sessions count (a counted session is a treatment performed). OWNER-SIGNOFF: a session's value = its allocated session value
// (BILL-7), as in the S11 journal; "consultation fees charged" counts the charge (not the payment).
const K2 = () => byBranch(F.performances.filter((x) => inMonth(x.day)), (x) => x.value);
// K3 — lines and package contract value after discount, excl. VAT, by sale date, selling branch; − cancelled unpaid package remainders
// (month of cancellation) − refunded sale value (month of refund); voided invoices excluded.
const K3 = () => {
  const base = byBranch(F.sales.filter((s) => inMonth(s.day) && !s.voided), (s) => s.value - s.vat);
  const red = byBranch(F.saleReductions.filter((r) => inMonth(r.day)), (r) => r.amount);
  return { A: base.A - red.A, B: base.B - red.B };
};
// K4 — patient receivables + unpaid lines of closed visits, aged 0–30/31–60/61–90/>90 at the period end; excludes unpaid package
// remainders and in-progress visits. A written-off receivable is not owed (B-14). An unpaid line counts once its visit is closed by the
// period end and ages from its invoice's issue day (DEC-121, Panel 2 slice 4 option (b); the reader test "K4 (decision 1 (b))" below).
// Still a DRAFT calculator check: the finance sign-off is not recorded here.
const K4 = (asOf = MONTH.to) => {
  const items = [
    ...F.receivables.map((r) => ({ branch: r.branch, from: r.openedDay, amount: r.amount - r.collected - r.writtenOff })),
    ...F.unpaidClosedLines.filter((l) => l.closedDay <= asOf).map((l) => ({ branch: l.branch, from: l.issuedDay, amount: l.amount })),
  ].filter((x) => x.amount > 0);
  const bucket = (d: number) => (d <= 30 ? "0-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : ">90");
  const out: Record<string, number> = { "0-30": 0, "31-60": 0, "61-90": 0, ">90": 0 };
  for (const x of items) out[bucket(days(x.from, asOf))] += x.amount;
  return { buckets: out, total: sum(Object.values(out)), byBranch: byBranch(items, (x) => x.amount) };
};
// K5 — paid-not-delivered + package liability + patient balance + booking DP; expiry slice for packages only.
const K5 = () => ({ total: sum(F.liabilities.map((l) => l.amount)),
  packages: sum(F.liabilities.filter((l) => l.kind === "packages").map((l) => l.amount)),
  packagesExpiring30: sum(F.liabilities.filter((l) => l.kind === "packages" && l.expiresWithin30).map((l) => l.amount)) });
// K6 — paid-unused value moved to balance at expiry; selling branch.
const K6 = () => byBranch(F.expiries.filter((e) => inMonth(e.day)), (e) => e.amount);
// K7 — K2 − material cost − product cost (moving average) − performer commission; executing branch; "estimasi" where consumption is
// standard (only those rows). The selling / guiding BC commission stays at the selling branch and is NOT deducted here (B-17).
const K7 = () => {
  const rows = F.performances.filter((x) => inMonth(x.day));
  const v = byBranch(rows, (x) => x.value - x.materialCost - x.productCost - x.performerCommission);
  return { ...v, estimasi: { A: rows.some((x) => x.branch === "A" && x.standardConsumption), B: rows.some((x) => x.branch === "B" && x.standardConsumption) } };
};
// K8 — consultation visits with a qualifying purchase on that visit ÷ consultation visits; visit branch.
const K8 = () => { const c = F.visits.filter((v) => inMonth(v.day) && v.consultation); return { num: c.filter((v) => v.qualifyingPurchase).length, den: c.length }; };
// K9 — plan items selected ÷ recommended (count and value) within 30/60/90 days of the recommendation; visit branch.
const K9 = (window: 30 | 60 | 90) => {
  const rec = F.plans.filter((p) => inMonth(p.recommendedDay));
  const sel = rec.filter((p) => p.selectedDay && days(p.recommendedDay, p.selectedDay) <= window);
  return { count: [sel.length, rec.length], value: [sum(sel.map((p) => p.value)), sum(rec.map((p) => p.value))] };
};
// K10 — first visit in tenant vs repeat (visits in the period); visit branch.
const firstVisit = (patient: string) => F.visits.filter((v) => v.patient === patient).sort((a, b) => a.day.localeCompare(b.day))[0];
const K10 = () => { const v = F.visits.filter((x) => inMonth(x.day)); const isNew = (x: Visit) => firstVisit(x.patient).id === x.id;
  return { new: v.filter(isNew).length, returning: v.filter((x) => !isNew(x)).length }; };
// K11 — new patients (first visit in the period) with a completed second visit within 60 days (D-06) ÷ new patients; first-visit branch.
const K11 = () => {
  const first = [...new Set(F.visits.map((v) => v.patient))].map(firstVisit).filter((v) => inMonth(v.day));
  const second = first.filter((f) => F.visits.some((v) => v.patient === f.patient && v.id !== f.id && v.completed && v.day > f.day && days(f.day, v.day) <= 60));
  return { num: second.length, den: first.length };
};
// K12 — no-shows + late cancels ÷ booked; booking branch. OWNER-SIGNOFF: "booked" = the appointments of the period that stayed on the
// book — an early cancel (≥ 24 h before the start) leaves the denominator, as a reschedule would (DEC-121, Panel 2 slice 4 option (b); the
// reader test "K12 (decision 2 (b))" below). Still a DRAFT calculator check: the finance sign-off is not recorded here.
const K12 = () => {
  const b = F.appointments.filter((a) => inMonth(a.day) && a.state !== "cancelled_early");
  return { num: b.filter((a) => a.state === "no_show" || a.state === "cancelled_late").length, den: b.length };
};
// K13 — lead → booked → arrived → paid, by source, branch, assignee.
const K13 = () => {
  const by = (k: "source" | "assignee") => Object.fromEntries([...new Set(F.leads.map((l) => l[k]))].map((s) => {
    const ls = F.leads.filter((l) => l[k] === s);
    return [s, [ls.length, ls.filter((l) => l.booked).length, ls.filter((l) => l.arrived).length, ls.filter((l) => l.paid).length]];
  }));
  return { source: by("source"), assignee: by("assignee") };
};
// K14 — median first response; % within 15 min in opening hours (D-08). AMBIGUITY (K14 row): whether the median covers only leads arriving
// in opening hours or all leads — drafted as opening-hours leads only (the SLA population); the % is over the same population.
const K14 = () => {
  const mins = F.leads.filter((l) => l.inOpeningHours && l.firstResponseAt).map((l) => (Date.parse(l.firstResponseAt!) - Date.parse(l.createdAt)) / 60_000).sort((a, b) => a - b);
  const median = mins.length % 2 ? mins[(mins.length - 1) / 2] : (mins[mins.length / 2 - 1] + mins[mins.length / 2]) / 2;
  return { medianMinutes: median, within15: [mins.filter((m) => m <= 15).length, mins.length] };
};
// K15 — booked or executed minutes ÷ rostered minutes; branch. Per performer-day the union of booked and executed intervals (an overlap
// counted once) over the rostered work less breaks (DEC-121, Panel 2 slice 4 option (b); the reader test "K15 (decision 4 (b))" below).
// Still a DRAFT calculator check: the finance sign-off is not recorded here.
const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const spanMin = (xs: Span[]) => sum(xs.map(([a, b]) => hm(b) - hm(a)));
const unionMin = (xs: Span[]) => {
  let total = 0; let end = -1;
  for (const [a, b] of xs.map(([x, y]) => [hm(x), hm(y)]).sort((p, q) => p[0] - q[0])) {
    if (b > end) { total += b - Math.max(a, end); end = b; }
  }
  return total;
};
const K15 = () => ({ num: sum(F.rosters.map((r) => unionMin([...r.booked, ...r.executed]))), den: sum(F.rosters.map((r) => spanMin(r.work) - spanMin(r.breaks))) });
// K16 — treatment visits with a product sale ÷ treatment visits; visit branch.
const K16 = () => { const t = F.visits.filter((v) => inMonth(v.day) && v.treatment); return { num: t.filter((v) => v.productSale).length, den: t.length }; };
// K17 — entitlements − adjustments by staff, role, contribution, with approval state; branch of contribution. A paid entitlement is not
// owed (it is settled): OWNER-SIGNOFF — "terutang" excludes paid batches.
const K17 = () => F.commissions.filter((c) => c.state !== "paid").map((c) => ({ staff: c.staff, role: c.role, branch: c.branch, owed: c.entitlement + c.adjustment, state: c.state }));
// K18 — items below minimum; batches expiring within 30 days; count variance; branch.
const K18 = () => ({ belowMin: F.stock.filter((s) => s.onHand < s.minQty).map((s) => `${s.branch}:${s.item}`),
  expiring30: sum(F.stock.map((s) => s.batchesExpiring30)), varianceItems: F.stock.filter((s) => s.countVariance !== 0).map((s) => `${s.branch}:${s.item}`) });
// K19 — closing value per month vs target (D-07; target_closing_value, 0103:151): the month's real (non-simulated) payments on the
// non-consultation lines the BC closed, net of VAT, less the month's paid refunds on those lines; attainment in basis points, truncated
// (target_row). "Plans fully selected" is not claimed here: the fixture's plans carry no closing BC (it is proved in the reader tests).
const closingLines = (bc: string) => F.sales.filter((x) => x.closingBc === bc && inMonth(x.day) && !x.voided && !x.consultation
  && F.payments.some((p) => p.id === x.id.split("-")[0] && inMonth(p.day) && !p.simulated));
const K19 = () => F.targets.map((t) => {
  const lines = closingLines(t.bc); const ids = new Set(lines.map((x) => x.id));
  const closing = Math.max(0, sum(lines.map((x) => x.value - x.vat)) - sum(F.saleReductions.filter((r) => r.why === "refund" && inMonth(r.day) && ids.has(r.sale)).map((r) => r.amount)));
  return { bc: t.bc, branch: t.branch, closing, target: t.target, bps: Math.trunc((closing * 10_000) / t.target) };
});

// ── expected values (the fixture) ──────────────────────────────────────────────────────────────────────────────────────────────────
describe("T-107 K1–K19 fixture (synthetic month 2026-10, branches A and B; formulas of 02-PRD Appendix A; money facts from DEC-080)", () => {
  it("K1 Uang masuk: 555,000 + 1,500,000 + 400,000 + 150,000 + 3,000,000 − 333,000 cash refund = 5,272,000 at A; balance usage and the simulated payment excluded", () => {
    expect(K1()).toEqual({ A: 5_272_000, B: 0, total: 5_272_000, byMethod: { cash: 3_705_000, qris: 1_500_000, edc: 400_000 } });
  });
  it("K2 Layanan selesai at the executing branch: A 2,605,000 (products 555,000, treatments 1,900,000, consultation 150,000); B 600,000 (S11 session) — PR-33a", () => {
    expect(K2()).toEqual({ A: 2_605_000, B: 600_000 });
  });
  it("K3 Penjualan at the selling branch: lines 2,605,000 + package 3,000,000 − serum refund 333,000 − S8 cancelled unpaid remainder 2,000,000 = 3,272,000; the void excluded; B 0 — PR-33a (S11 counts at A)", () => {
    expect(K3()).toEqual({ A: 3_272_000, B: 0 });
  });
  // DRAFT (owner / finance pending; not an acceptance assertion): K4, K12, K14, K15, K17 are calculator checks of the drafted readings only.
  it("DRAFT K4 Piutang at 2026-10-31: S3b 400,000 (72 days → 61–90), the closed-visit line 222,000 aged from its invoice issue day (51 days → 31–60); S14 written off excluded", () => {
    expect(K4()).toEqual({ buckets: { "0-30": 0, "31-60": 222_000, "61-90": 400_000, ">90": 0 }, total: 622_000, byBranch: { A: 400_000, B: 222_000 } });
    // before its visit closed (2026-10-25) the line is not yet a closed-visit receivable: at 2026-10-20 only S3b (61 days → 61–90)
    expect(K4("2026-10-20")).toEqual({ buckets: { "0-30": 0, "31-60": 0, "61-90": 400_000, ">90": 0 }, total: 400_000, byBranch: { A: 400_000, B: 0 } });
  });
  it("K5 Kewajiban prabayar: packages 2,700,000 (300,000 expiring within 30 days) + balance 1,000,000 + DP 200,000 = 3,900,000", () => {
    expect(K5()).toEqual({ total: 3_900_000, packages: 2_700_000, packagesExpiring30: 300_000 });
  });
  it("K6 Paket kedaluwarsa ke saldo: S8 1,000,000 at A", () => {
    expect(K6()).toEqual({ A: 1_000_000, B: 0 });
  });
  it("K7 Kontribusi: A 2,605,000 − materials 120,000 − products 240,000 − performers 100,000 = 2,145,000 (estimasi: S3a standard consumption); B 600,000 − 50,000 = 550,000 (not estimated)", () => {
    expect(K7()).toEqual({ A: 2_145_000, B: 550_000, estimasi: { A: true, B: false } });
  });
  it("K8 Konsultasi jadi pembelian: 1 of 2 consultation visits (V5 bought; V4 did not)", () => {
    expect(K8()).toEqual({ num: 1, den: 2 });
  });
  it("K9 Rencana dipilih: within 30 days 1 of 3 (1,500,000 of 2,566,000); within 60 days 2 of 3 (2,166,000)", () => {
    expect(K9(30)).toEqual({ count: [1, 3], value: [1_500_000, 2_566_000] });
    expect(K9(60)).toEqual({ count: [2, 3], value: [2_166_000, 2_566_000] });
    expect(K9(90)).toEqual(K9(60));
  });
  it("K10 Pasien baru vs kembali: 4 new (P1, P2, P3, P4) and 2 returning (P2's second visit, P5 first seen in June)", () => {
    expect(K10()).toEqual({ new: 4, returning: 2 });
  });
  it("K11 Kunjungan kedua: 1 of 4 new patients came back within 60 days (P2: 21 days)", () => {
    expect(K11()).toEqual({ num: 1, den: 4 });
  });
  it("DRAFT K12 Tidak datang / batal < 24 jam: 2 of 5 on the book (one no-show, one late cancel; the early cancel leaves the denominator)", () => {
    expect(K12()).toEqual({ num: 2, den: 5 });
  });
  it("K13 Konversi lead by source and assignee: instagram 2 → 2 → 1 → 1; google 2 → 0 → 0 → 0", () => {
    expect(K13()).toEqual({ source: { instagram: [2, 2, 1, 1], google: [2, 0, 0, 0] }, assignee: { CS1: [2, 2, 1, 1], CS2: [2, 0, 0, 0] } });
  });
  it("DRAFT K14 Respons lead (opening-hours leads): median 10 minutes; 2 of 3 within 15 minutes", () => {
    expect(K14()).toEqual({ medianMinutes: 10, within15: [2, 3] });
  });
  it("DRAFT K15 Utilisasi performer: booked ∪ executed (360 + 240) ÷ rostered work less breaks (420 + 420) — not the larger of the two (300 + 180)", () => {
    expect(K15()).toEqual({ num: 600, den: 840 });
  });
  it("K16 Lampiran produk: 2 of 4 treatment visits had a product sale", () => {
    expect(K16()).toEqual({ num: 2, den: 4 });
  });
  it("DRAFT K17 Komisi terutang from the signed figures: closing BC 272,750 − 16,650 = 256,100; guiding 90,000 (approved); registrar 20,550; B performer 50,000; A performer paid → not owed", () => {
    expect(K17()).toEqual([
      { staff: "BC1", role: "closing_bc", branch: "A", owed: 256_100, state: "accrued" },
      { staff: "BC2", role: "guiding_bc", branch: "A", owed: 90_000, state: "approved" },
      { staff: "R1", role: "registrar", branch: "A", owed: 20_550, state: "accrued" },
      { staff: "D2", role: "performer", branch: "B", owed: 50_000, state: "accrued" },
    ]);
  });
  it("K18 Risiko stok: serum at A below minimum; 1 batch expiring within 30 days; sunscreen at A has a count variance", () => {
    expect(K18()).toEqual({ belowMin: ["A:serum"], expiring30: 1, varianceItems: ["A:sunscreen"] });
  });
  it("K19 Target BC (D-07): BC1 closed S1 + S2 + S3a + S11 = 5,455,000 − the S15b serum refund 333,000 = 5,122,000 of 6,000,000 (8,536 bps); the S4a consultation is not closing value; BC3 0 of 2,000,000", () => {
    expect(K19()).toEqual([
      { bc: "BC1", branch: "A", closing: 5_122_000, target: 6_000_000, bps: 8_536 },
      { bc: "BC3", branch: "B", closing: 0, target: 2_000_000, bps: 0 },
    ]);
    // the inputs that decide it: the consultation would add 150,000 (5,272,000 = K1), the refund would add 333,000
    expect(sum(closingLines("BC1").map((x) => x.value))).toBe(5_455_000);
    expect(F.sales.filter((x) => x.closingBc === "BC1" && x.consultation).map((x) => x.value)).toEqual([150_000]);
  });
  it("PR-33a: a package sold at A and a session counted at B — K3 counts at A, K2 at B", () => {
    expect([K3().A > 0, K2().B]).toEqual([true, 600_000]);
    expect(F.sales.find((s) => s.id === "S11")!.branch).toBe("A");
  });
});

// ── real-writer facts (slice 2): the settled assertions on facts persisted by the real writers — no reader is assumed. Each test checks
// the stored source facts a K reader will read (tables and columns named), separately from the reference calculator above. ──────────
// Settled here: K1 (cash vs balance usage vs a simulated payment; a cash refund) and S11 cross-branch attribution (sale at the selling
// branch, the counted session at the executing branch, valued at its BILL-7 allocation). Drafted K rows and unlinked hand-overs: not here.
process.env.DEPLOY_ENV = "local";
let h: Harness; let app: pg.Pool; let worker: pg.Pool; let owner: pg.Pool; let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
// Level 2 (tenant-wide) roles carry no branch (staff_branches_level3_check); every other role gets one.
const TENANT_WIDE: string[] = ROLES.filter((r) => !(LEVEL3_ROLES as readonly string[]).includes(r));
const STEP: StepUp = { verified: true };
const key = () => crypto.randomUUID();
async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Ringkasan Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("RK-A"), b2: await br("RK-B") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`rk${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Ringkasan ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
function png(): Buffer {
  const b = Buffer.alloc(80);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write("IHDR", 12, "latin1"); b.writeUInt32BE(640, 16); b.writeUInt32BE(240, 20);
  return b;
}
async function patient(t: T, branch: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Ringkasan', '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)])).rows[0].id as string;
}
async function credential(t: T, p: P, branch: string, fh: P, own: P) {
  for (const [kind, b] of [["str", null], ["sip", branch]] as const) {
    const id = (await h.admin.query(
      `insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
       values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`,
      [t.tenantId, p.staffId, kind, `NO-${++n}`, b, b ? "2099-12-31" : null, own.staffId])).rows[0].id as string;
    await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, fh.staffId]);
  }
}
async function visitWith(t: T, pid: string, branch: string, version: string, doc: P, fo: P) {
  const d = branch === doc.branch ? doc : { ...doc, branch };
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [t.tenantId, branch, pid, fo.staffId])).rows[0].id as string;
  const { examId } = await as(d, (db) => openExam(db, key(), v));
  const { planId } = await as(d, (db) => createPlan(db, key(), examId, "Program Ringkasan", "Kondisi rahasia"));
  const { itemId } = await as(d, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: version, qty: 1 }));
  await as(d, (db) => signRecord(db, key(), examId, STEP));
  const ct = await as(d, (db) => consentText(db, v, planId));
  await as(d, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: ct.content_hash, signature: png() }));
  return { v, item: itemId as string };
}
let A: T; let OWN: P; let FH: P; let DOC: P; let FO: P; let FOB2: P; let MGR: P;
let facial: string; let facialV: string;

describe("T-107 slice 2: settled K1 and S11 attribution on facts persisted by the real writers (no reader assumed)", () => {
  beforeAll(async () => {
    setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
    h = await createHarness();
    const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
    app = await openAppPool({ connectionString: login, max: 6 });
    worker = await openAppPool({ connectionString: login, max: 2 });
    owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
    A = await tenant();
    OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1); DOC = await person(A, "doctor", A.b1, A.b2);
    FO = await person(A, "fo_cashier", A.b1); FOB2 = await person(A, "fo_cashier", A.b2); MGR = await person(A, "manager", A.b1);
    await credential(A, DOC, A.b1, FH, OWN);
    await credential(A, DOC, A.b2, FH, OWN);
    const v = await as(OWN, (db) => publish(db, { kind: "service", code: "RK-FAC" }, {
      name: "Facial Ringkasan", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 600_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat persetujuan.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Layanan baru"));
    if (v.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [v.approvalId]));
    ({ itemId: facial, versionId: facialV } = v);
    await as(MGR, (db) => enableMockPort(db));
  }, 300_000);

  it("S11 cross-branch: the package sale (K3 source) is stored at the selling branch A; the counted session (K2 source) at the executing branch B, valued at its BILL-7 allocation 600,000", async () => {
    const pv = await as(OWN, (db) => publish(db, { kind: "package", code: "RK-P11" }, { name: "Paket Ringkasan", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 3_000_000, installments_allowed: true } as never, "Paket"));
    await as(OWN, (db) => setPackageContents(db, key(), pv.versionId, [{ serviceItemId: facial, count: 5 }]));
    const pid = await patient(A, A.b1);
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: pv.itemId, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 3_000_000, cashTendered: 3_000_000 }]));
    const pkg = (await h.admin.query(`select id, sold_branch_id, price::bigint price from packages where invoice_id = $1`, [invoiceId])).rows[0];
    // K3 source facts: the package contract value and its selling branch (packages.sold_branch_id / price; the invoice line's branch)
    expect([pkg.sold_branch_id, Number(pkg.price)]).toEqual([A.b1, 3_000_000]);
    expect((await h.admin.query(`select branch_id, line_total::bigint t, vat_amount::bigint v from invoice_lines where invoice_id = $1`, [invoiceId])).rows
      .map((r) => [r.branch_id, Number(r.t), Number(r.v)])).toEqual([[A.b1, 3_000_000, 0]]);
    // one session counted at branch B
    const { v, item } = await visitWith(A, pid, A.b2, facialV, DOC, FOB2);
    await as(FOB2, (db) => reserveSession(db, key(), pkg.id, v));
    const d = { ...DOC, branch: A.b2 };
    const e = await as(d, (db) => startTreatment(db, key(), v, { planItemId: item, performerId: DOC.staffId, identityConfirmed: true }));
    await as(d, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    // K2 source facts: the redeemed session at the executing branch B with its allocated value (BILL-7: 3,000,000 / 5 = 600,000) and the
    // counted execution at B — never the selling branch
    const s = (await h.admin.query(`select redeemed_branch_id, allocated_value::bigint v, vat_amount::bigint vat from package_sessions where package_id = $1 and state = 'redeemed'`, [pkg.id])).rows;
    expect(s.map((r) => [r.redeemed_branch_id, Number(r.v), Number(r.vat)])).toEqual([[A.b2, 600_000, 0]]);
    expect((await h.admin.query(`select branch_id, counted, state from treatment_executions where id = $1`, [e.executionId])).rows[0]).toEqual({ branch_id: A.b2, counted: true, state: "finished" });
    // the reference calculator on the same shape agrees: K3 at A, K2 at B (PR-33a)
    expect([K3().A > 0, K2().B]).toEqual([true, 600_000]);
  });

  it("K1 sources: cash and QRIS received count; balance usage is a payment row with method balance (not new cash); a simulated payment is flagged and never counts; a cash refund is a refunds row paid in cash", async () => {
    const pid = await patient(A, A.b1);
    await as(FO, (db) => topUpBalance(db, key(), pid, null, { method: "cash", amount: 500_000, cashTendered: 500_000 })); // K1 +500,000 (cash in)
    // a treatment line paid partly by balance (not new cash) and partly in cash
    const inv2 = (await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }))).invoiceId;
    await as(FO, (db) => issueKasirInvoice(db, key(), inv2, [{ itemId: facial, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), inv2, [{ method: "balance", amount: 200_000 }, { method: "cash", amount: 400_000, cashTendered: 400_000 }]));
    // a simulated QRIS payment on another invoice (BILL-29)
    const inv3 = (await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }))).invoiceId;
    await as(FO, (db) => issueKasirInvoice(db, key(), inv3, [{ itemId: facial, quantity: 1 }]));
    const c = await as(FO, (db) => createCharge(db, key(), inv3, { channel: "qris" }));
    const w = await as(FO, (db) => simulate(db, c.charge_id, "paid", A.tenantId));
    await receiveMockWebhook(worker, w.rawBody, w.headers[SIGNATURE_HEADER], "local");
    // a cash refund exception (owner-approved) of an undelivered line
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [inv2])).rows[0].id;
    const r = await as(FO, (db) => requestRefund(db, key(), line, { amount: 400_000, reason: "Tidak jadi tindakan", destination: "cash" }));
    if (r.approval_id) await as(OWN, (db) => decideApproval(db, r.approval_id!, true));
    if ((await h.admin.query(`select state from refunds where id = $1`, [r.refund_id])).rows[0].state !== "paid") await as(FO, (db) => payRefund(db, key(), r.refund_id, "cash"));
    const pays = (await h.admin.query(`select method, amount::bigint a, is_simulated sim, branch_id from payments where patient_id = $1 order by received_at, seq`, [pid])).rows
      .map((x) => [x.method, Number(x.a), x.sim, x.branch_id === A.b1]);
    expect(pays).toEqual(expect.arrayContaining([["cash", 500_000, false, true], ["balance", 200_000, false, true], ["cash", 400_000, false, true], ["qris", 600_000, true, true]]));
    const refunds = (await h.admin.query(`select destination, state, amount::bigint a, paid_method from refunds where id = $1`, [r.refund_id])).rows[0];
    expect([refunds.destination, refunds.state, Number(refunds.a), refunds.paid_method]).toEqual(["cash", "paid", 400_000, "cash"]);
    // K1 by the Appendix A text on these persisted facts: cash 500,000 + cash 400,000 − cash refund 400,000 = 500,000 (balance 200,000 and
    // the simulated 600,000 excluded) — computed from the stored rows, not from a reader
    const k1 = Number((await h.admin.query(`select coalesce(sum(amount), 0) s from payments where patient_id = $1 and method <> 'balance' and not is_simulated`, [pid])).rows[0].s)
      - Number((await h.admin.query(`select coalesce(sum(amount), 0) s from refunds where patient_id = $1 and destination = 'cash' and state = 'paid'`, [pid])).rows[0].s);
    expect(k1).toBe(500_000);
  });

  // ── slice 3: the T-107 readers (dashboard_kpi, dashboard_home; migration 0123 provisional) on the facts the two tests above persisted
  // in tenant A (both run first, in file order): S11 (package 3,000,000 cash at A; one session counted at B, 600,000) and the K1 set
  // (top-up 500,000 cash; a 600,000 line paid 200,000 balance + 400,000 cash; a simulated 600,000 QRIS; a 400,000 cash refund). ──
  const period = async () => (await h.admin.query<{ from: string; to: string }>(
    `select to_char((now() at time zone 'Asia/Jakarta')::date - 30, 'YYYY-MM-DD') as "from", to_char((now() at time zone 'Asia/Jakarta')::date + 1, 'YYYY-MM-DD') as "to"`)).rows[0];
  const code = (e: unknown) => (e instanceof CommandError ? e.code : String(e));

  it("K1 reader on the persisted facts: 3,000,000 + 500,000 + 400,000 cash − 400,000 cash refund = 3,500,000 at A; balance usage and the simulated QRIS excluded", async () => {
    const p = await period();
    const r = await as(OWN, (db) => kpi(db, { kpi: "k1", ...p }));
    expect([r.total, r.by_dim]).toEqual([3_500_000, { cash: 3_900_000, cash_refund: -400_000 }]);
    expect(Object.keys(r.by_branch)).toEqual([A.b1]);
  });

  it("K2 / K3 readers, PR-33a: the S11 session counts at the executing branch B (600,000); the sale at the selling branch A — package 3,000,000 + two 600,000 lines − the 400,000 refund = 3,800,000", async () => {
    const p = await period();
    const k2 = await as(OWN, (db) => kpi(db, { kpi: "k2", ...p }));
    expect([k2.total, k2.by_branch]).toEqual([600_000, { [A.b2]: { session: 600_000 } }]);
    const k3 = await as(OWN, (db) => kpi(db, { kpi: "k3", ...p }));
    expect([k3.total, k3.by_branch]).toEqual([3_800_000, { [A.b1]: { package: 3_000_000, line: 1_200_000, refund: -400_000 } }]);
  });

  it("K3 excludes a voided invoice: a 600,000 line issued then voided (manager-approved) leaves K3 at 3,800,000 and is in no drill-down row", async () => {
    const pid = await patient(A, A.b1);
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
    const { approvalId } = await as(FO, (db) => requestVoid(db, key(), invoiceId, "Salah item"));
    await as(MGR, (db) => decideApproval(db, approvalId, true));
    expect((await h.admin.query(`select state from invoices where id = $1`, [invoiceId])).rows[0].state).toBe("void");
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id;
    const p = await period();
    const k3 = await as(OWN, (db) => kpi(db, { kpi: "k3", ...p, detail: true }));
    expect(k3.total).toBe(3_800_000);
    expect(k3.rows!.map((r) => r.source_id)).not.toContain(line);
  });

  it("K9 / K10 readers: the one plan item recommended at B (600,000, not selected) and the one visit (new)", async () => {
    const p = await period();
    expect((await as(OWN, (db) => kpi(db, { kpi: "k9", ...p }))).by_dim).toEqual({ recommended_count: 1, recommended_value: 600_000 });
    expect((await as(OWN, (db) => kpi(db, { kpi: "k10", ...p }))).by_dim).toEqual({ new: 1 });
  });

  it("drill-down: the K1 detail rows are the payments and the refund behind the value, and their money sums to the total", async () => {
    const p = await period();
    const r = await as(OWN, (db) => kpi(db, { kpi: "k1", ...p, detail: true }));
    expect(r.rows!.reduce((s, x) => s + x.amount, 0)).toBe(r.total);
    expect(new Set(r.rows!.map((x) => x.source_kind))).toEqual(new Set(["payment", "refund"]));
  });

  it("PR-33 no clinical content: every KPI payload and detail row carries only the allow-listed keys and never the plan's condition text", async () => {
    const p = await period();
    for (const k of ["k1", "k2", "k3", "k6", "k7", "k8", "k9", "k10", "k11", "k16"] as const) {
      const r = await as(OWN, (db) => kpi(db, { kpi: k, ...p, detail: true }));
      expect(Object.keys(r).sort()).toEqual(["as_of", "branch_id", "by_branch", "by_dim", "by_grp1", "by_grp2", "extra", "from", "kpi", "rows", "to", "total"]);
      for (const row of r.rows!) expect(Object.keys(row).sort()).toEqual(["amount", "branch_id", "day", "dim", "source_id", "source_kind"]);
      expect(JSON.stringify(r)).not.toContain("Kondisi rahasia");
    }
  });

  it("roles: FO / cashier and a doctor are refused; a manager reads only the active branch (another branch is not found); marketing reads K13 but not K1", async () => {
    const p = await period();
    for (const who of [FO, DOC]) await expect(as(who, (db) => kpi(db, { kpi: "k1", ...p }))).rejects.toSatisfy((e) => code(e) === "ERR_FORBIDDEN");
    const m = await as(MGR, (db) => kpi(db, { kpi: "k2", ...p }));
    expect([m.branch_id, m.total]).toEqual([A.b1, null]); // the session counted at B is not in the manager's branch view
    await expect(as(MGR, (db) => kpi(db, { kpi: "k1", ...p, branchId: A.b2 }))).rejects.toSatisfy((e) => code(e) === "ERR_NOT_FOUND");
    const mk = await person(A, "marketing", A.b1);
    expect((await as(mk, (db) => kpi(db, { kpi: "k13", ...p }))).kpi).toBe("k13");
    await expect(as(mk, (db) => kpi(db, { kpi: "k1", ...p }))).rejects.toSatisfy((e) => code(e) === "ERR_FORBIDDEN");
  });

  it("cross-tenant (TEN-1): another tenant's owner reads nothing of tenant A and gets not-found for A's branch", async () => {
    const p = await period();
    const B = await tenant();
    const ownB = await person(B, "owner");
    const r = await as(ownB, (db) => kpi(db, { kpi: "k1", ...p, detail: true }));
    expect([r.total, r.rows]).toEqual([null, []]);
    await expect(as(ownB, (db) => kpi(db, { kpi: "k3", ...p, branchId: A.b1 }))).rejects.toSatisfy((e) => code(e) === "ERR_NOT_FOUND");
    const hb = await as(ownB, (db) => roleHome(db, null));
    expect(hb).toMatchObject({ home: "audit", manual_discounts: { count: 0 }, write_offs: { count: 0, amount: 0 } });
  });

  // ── slice 4: K4, K12, K14, K15, K17 per Panel 2 PANEL2-DECISIONS-SLICE4.md, on a fresh tenant whose rows carry the dates that tell the
  // decided options apart. The writers stamp clock_timestamp(), so these facts are inserted directly with every user trigger of the seeded
  // tables off for the seed only (the practice of tests/accounting/subledgers.test.ts); the readers then run through clinic_app as usual. ──
  async function seedRaw(tables: string[], fn: () => Promise<void>) {
    const off: [string, string][] = [];
    for (const tb of tables) for (const r of (await h.admin.query(`select tgname from pg_trigger where tgrelid = $1::regclass and not tgisinternal and tgenabled <> 'D'`, [tb])).rows) off.push([tb, r.tgname]);
    for (const [tb, tg] of off) await h.admin.query(`alter table ${tb} disable trigger ${tg}`);
    try { await fn(); } finally { for (const [tb, tg] of off) await h.admin.query(`alter table ${tb} enable always trigger ${tg}`); }
  }
  const P4 = { from: "2026-10-01", to: "2026-10-31" };
  const at = (local: string) => `${local}+07`; // Asia/Jakarta
  let S4: { t: T; own: P; mgr: P; doc: P; nurse: P; pid: string; pid2: string; svc: string; svcV: string };
  async function slice4() {
    if (S4) return S4;
    const t = await tenant();
    const own = await person(t, "owner"); const mgr = await person(t, "manager", t.b1);
    const doc = await person(t, "doctor", t.b1); const nurse = await person(t, "nurse", t.b1);
    const pid = await patient(t, t.b1); const pid2 = await patient(t, t.b1);
    const svc = (await h.admin.query(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'service', 'K4-SVC', $2) returning id`, [t.tenantId, own.staffId])).rows[0].id as string;
    const svcV = (await h.admin.query(`insert into catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, reason, created_by, created_as)
      values ($1, $2, 1, 'active', 'Layanan Ringkasan', 'exempt_medical', 'Jasa medis', 500000, 'Layanan baru', $3, 'owner') returning id`, [t.tenantId, svc, own.staffId])).rows[0].id as string;
    S4 = { t, own, mgr, doc, nurse, pid, pid2, svc, svcV };
    return S4;
  }

  it("K4 (decision 1 (b)): an unpaid line of a closed visit ages from invoices.issued_at, not visits.closed_at; a receivable from its created_at; a collected receivable and the paid part are not owed", async () => {
    const { t, own, pid, pid2, svc, svcV } = await slice4();
    await seedRaw(["visits", "invoices", "invoice_lines", "receivables", "receivable_collections"], async () => {
      // issued 2026-08-20, visit closed 2026-10-20: 72 days at 2026-10-31 by (b) → 61-90 (by (a) it would be 0-30)
      const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at, closed_at, closed_by)
        values ($1, $2, $3, 'walk_in', $4, $5, $6, $4) returning id`, [t.tenantId, t.b1, pid, own.staffId, at("2026-08-20 09:00"), at("2026-10-20 10:00")])).rows[0].id;
      const i = (await h.admin.query(`insert into invoices (tenant_id, branch_id, sold_branch_id, patient_id, visit_id, number, state, is_pkp_at_issue, issued_at, issued_by, issued_as, command_key, created_by, created_as)
        values ($1, $2, $2, $3, $4, 'K4-1', 'issued', false, $5, $6, 'fo_cashier', $7, $6, 'fo_cashier') returning id`, [t.tenantId, t.b1, pid, v, at("2026-08-20 09:30"), own.staffId, `k4-${key()}`])).rows[0].id;
      await h.admin.query(`insert into invoice_lines (tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, line_total, tax_category, tax_basis, vat_base, vat_amount)
        values ($1, $2, $3, $4, $5, 1, 222000, 222000, 'exempt_medical', 'Jasa medis', 222000, 0)`, [t.tenantId, t.b1, i, svc, svcV]);
      // a receivable opened 2026-10-25 (6 days → 0-30) of 400,000, 150,000 collected by p_to
      const v2 = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at, closed_at, closed_by)
        values ($1, $2, $3, 'walk_in', $4, $5, $5, $4) returning id`, [t.tenantId, t.b1, pid2, own.staffId, at("2026-10-25 09:00")])).rows[0].id;
      const r = (await h.admin.query(`insert into receivables (tenant_id, branch_id, patient_id, visit_id, amount, command_key, created_by, created_as, created_at)
        values ($1, $2, $3, $4, 400000, $5, $6, 'fo_cashier', $7) returning id`, [t.tenantId, t.b1, pid2, v2, `rc-${key()}`, own.staffId, at("2026-10-25 10:00")])).rows[0].id;
      const rcpt = (await h.admin.query(`insert into receipts (tenant_id, branch_id, number, total, body, paper, command_key, issued_by, issued_as)
        values ($1, $2, 'K4-R', 150000, 'Kuitansi sintetis K4', '80mm', $3, $4, 'fo_cashier') returning id`, [t.tenantId, t.b1, `kr-${key()}`, own.staffId])).rows[0].id;
      await h.admin.query(`insert into receivable_collections (tenant_id, branch_id, receivable_id, receipt_id, method, amount, command_key, received_by, received_as, received_at)
        values ($1, $2, $3, $4, 'cash', 150000, $5, $6, 'fo_cashier', $7)`, [t.tenantId, t.b1, r, rcpt, `kc-${key()}`, own.staffId, at("2026-10-28 10:00")]);
    });
    const r = await as(own, (db) => kpi(db, { kpi: "k4", ...P4 }));
    expect([r.total, r.by_dim, r.extra]).toEqual([472_000, { "61-90": 222_000, "0-30": 250_000 }, { undated_cancellations: 0, complete: true }]);
  });

  it("K12 (decision 2 (b)): no-show + cancel < 24 h over the appointments that stayed on the book; an early cancel and a reschedule leave the denominator", async () => {
    const { t, own, doc, pid, svcV } = await slice4();
    await seedRaw(["appointments"], async () => {
      const ins = (start: string, state: string, changed: string | null, extra = "") => h.admin.query(
        `insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as,
                                   state_changed_at, state_changed_by, state_reason ${extra ? ", rescheduled_to" : ""})
         values ($1, $2, $3, $4, $5, $6::timestamptz, $6::timestamptz + interval '30 minutes', $7, 'phone', $8, 'fo_cashier', $9, $10, $11 ${extra ? ", $12" : ""}) returning id`,
        [t.tenantId, t.b1, pid, svcV, doc.staffId, at(start), state, own.staffId, changed ? at(changed) : null, changed ? own.staffId : null,
         state === "cancelled" ? "Pasien berhalangan" : null, ...(extra ? [extra] : [])]);
      await ins("2026-10-05 10:00", "arrived", "2026-10-05 09:55");
      await ins("2026-10-06 10:00", "no_show", "2026-10-06 11:00");
      await ins("2026-10-07 10:00", "cancelled", "2026-10-07 08:00"); // 2 h before: late
      await ins("2026-10-08 10:00", "cancelled", "2026-10-06 10:00"); // 48 h before: early → out
      await ins("2026-10-09 10:00", "confirmed", "2026-10-08 10:00");
      const target = (await ins("2026-10-12 10:00", "booked", null)).rows[0].id;
      await ins("2026-10-10 10:00", "rescheduled", "2026-10-09 10:00", target); // → out
    });
    const r = await as(own, (db) => kpi(db, { kpi: "k12", ...P4 }));
    expect([r.by_dim, r.extra]).toEqual([{ booked: 5, no_show: 1, late_cancel: 1 }, { booked: 5, failed: 2 }]);
  });

  it("K14 (decision 3 (a)): opening-hours leads only; median and both on-time shares (15 minutes literal, SET-20 configured 30)", async () => {
    const { t, own } = await slice4();
    await seedRaw(["branch_hours", "setting_versions", "leads"], async () => {
      for (const wd of [0, 1, 2, 3, 4, 5, 6]) await h.admin.query(`insert into branch_hours (tenant_id, branch_id, weekday, opens, closes) values ($1, $2, $3, '09:00', '17:00')`, [t.tenantId, t.b1, wd]);
      await h.admin.query(`insert into setting_versions (tenant_id, key, value, effective_from, state, changed_by, changed_as, changed_name, reason)
        values ($1, 'SET-20', '30'::jsonb, '2026-01-01', 'active', $2, 'owner', 'Pemilik', 'SLA uji')`, [t.tenantId, own.staffId]);
      const lead = (created: string, resp: string | null) => h.admin.query(
        `insert into leads (tenant_id, branch_id, source, stage, first_response_at, contacted_at, created_by, created_as, command_key, created_at)
         values ($1, $2, 'instagram', $3, $4, $4, $5, 'central_cs', $6, $7)`,
        [t.tenantId, t.b1, resp ? "contacted" : "new", resp ? at(resp) : null, own.staffId, `ld-${key()}`, at(created)]);
      await lead("2026-10-01 10:00", "2026-10-01 10:05"); // 5
      await lead("2026-10-02 10:00", "2026-10-02 10:20"); // 20: not within 15, within SET-20 30
      await lead("2026-10-03 10:00", "2026-10-03 10:45"); // 45: neither
      await lead("2026-10-04 10:00", null);                // unanswered
      await lead("2026-10-03 22:00", "2026-10-04 08:30"); // outside opening hours → out
    });
    const r = await as(own, (db) => kpi(db, { kpi: "k14", ...P4 }));
    expect(r.extra).toEqual({ leads: 4, answered: 3, median_minutes: 20, within_15m: 1, within_sla: 2, sla_minutes: 30, sla_mix: [{ minutes: 30, leads: 4, within: 2 }] });
  });

  it("K15 (decision 4 (b)): booked ∪ executed minutes per performer-day (an overlap counted once, a walk-in added) ÷ rostered work less break, a leave day out", async () => {
    const { t, own, doc, pid, pid2, svcV } = await slice4();
    await seedRaw(["catalog_versions", "branch_services", "service_staff_eligibility", "staff_shifts", "staff_leave", "appointments", "visits", "care_plans", "examinations", "plan_items", "treatment_executions"], async () => {
      // r3 (F4) / r4 (#1): the doctor performs the service, which branch A offers and which is in effect on the shift dates, so the
      // doctor's roster is performer capacity
      await h.admin.query(`update catalog_versions set created_at = '2026-01-01 00:00+07' where id = $1`, [svcV]);
      await h.admin.query(`insert into branch_services (tenant_id, branch_id, item_id) select tenant_id, $2, item_id from catalog_versions where id = $1 on conflict do nothing`, [svcV, t.b1]);
      await h.admin.query(`insert into service_staff_eligibility (tenant_id, version_id, role, mode) values ($1, $2, 'doctor', 'performs')`, [t.tenantId, svcV]);
      // 2026-10-14: work 09-17 (480) − break 12-13 (60) = 420; 2026-10-15 rostered but on leave → out
      for (const [d, s, e, k] of [["2026-10-14", "09:00", "17:00", "work"], ["2026-10-14", "12:00", "13:00", "break"], ["2026-10-15", "09:00", "17:00", "work"]])
        await h.admin.query(`insert into staff_shifts (tenant_id, branch_id, staff_id, shift_date, starts, ends, kind, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [t.tenantId, t.b1, doc.staffId, d, s, e, k, own.staffId]);
      await h.admin.query(`insert into staff_leave (tenant_id, branch_id, staff_id, kind, from_date, to_date, reason, created_by) values ($1, $2, $3, 'leave', '2026-10-15', '2026-10-15', 'Cuti uji', $4)`,
        [t.tenantId, t.b1, doc.staffId, own.staffId]);
      // booked 10:00–11:00 (arrived) and 14:00–14:30 (cancelled → out)
      await h.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as, state_changed_at, state_changed_by)
        values ($1, $2, $3, $4, $5, $6, $7, 'arrived', 'phone', $8, 'fo_cashier', $6, $8)`, [t.tenantId, t.b1, pid, svcV, doc.staffId, at("2026-10-14 10:00"), at("2026-10-14 11:00"), own.staffId]);
      await h.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as, state_changed_at, state_changed_by, state_reason)
        values ($1, $2, $3, $4, $5, $6, $7, 'cancelled', 'phone', $8, 'fo_cashier', $6, $8, 'Batal uji')`, [t.tenantId, t.b1, pid, svcV, doc.staffId, at("2026-10-14 14:00"), at("2026-10-14 14:30"), own.staffId]);
      // executed 10:30–11:30 (overlaps the booking: union 10:00–11:30 = 90) and a walk-in 15:00–15:30 (30) → 120 covered
      const exec = async (p: string, s: string, e: string) => {
        const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at) values ($1, $2, $3, 'walk_in', $4, $5) returning id`,
          [t.tenantId, t.b1, p, own.staffId, at(s)])).rows[0].id;
        const ex = (await h.admin.query(`insert into examinations (tenant_id, branch_id, visit_id, patient_id, author_id) values ($1, $2, $3, $4, $5) returning id`, [t.tenantId, t.b1, v, p, doc.staffId])).rows[0].id;
        const cp = (await h.admin.query(`insert into care_plans (tenant_id, branch_id, patient_id, title, condition, created_exam_id, created_by) values ($1, $2, $3, 'Program Uji', 'Kondisi rahasia', $4, $5) returning id`,
          [t.tenantId, t.b1, p, ex, doc.staffId])).rows[0].id;
        const pi = (await h.admin.query(`insert into plan_items (tenant_id, branch_id, plan_id, examination_id, stage, catalog_version_id, qty) values ($1, $2, $3, $4, 1, $5, 1) returning id`,
          [t.tenantId, t.b1, cp, ex, svcV])).rows[0].id;
        await h.admin.query(`insert into treatment_executions (tenant_id, branch_id, visit_id, plan_item_id, performer_staff_id, identity_confirmed, state, stage, started_at, started_by, started_as,
                               start_command_key, finished_at, finished_by, finished_as, finish_command_key, outcome)
          values ($1, $2, $3, $4, $5, true, 'finished', 'recovery', $6, $5, 'doctor', $7, $8, $5, 'doctor', $9, 'completed')`, // counted: generated from outcome
          [t.tenantId, t.b1, v, pi, doc.staffId, at(s), `st-${key()}`, at(e), `fn-${key()}`]);
      };
      await exec(pid, "2026-10-14 10:30", "2026-10-14 11:30");
      await exec(pid2, "2026-10-14 15:00", "2026-10-14 15:30");
    });
    // the two rostered days only (the K12 test above books this doctor on other October days of the same tenant)
    const r = await as(own, (db) => kpi(db, { kpi: "k15", from: "2026-10-14", to: "2026-10-15" }));
    expect([r.extra, r.by_grp1[doc.staffId]]).toEqual([{ covered_minutes: 120, rostered_minutes: 420 }, { covered: 120, rostered: 420 }]);
  });

  it("K17 (decision 5 (a), r3): owed from dated movements (a batch paid after p_to does not reduce it); batch states as the current workflow; the period's earned net", async () => {
    const { t, own, nurse, svc, svcV, pid } = await slice4();
    await seedRaw(["invoices", "invoice_lines", "commission_contributions", "commission_entitlements", "commission_adjustments", "approvals", "payout_batches", "payout_batch_items"], async () => {
      const i = (await h.admin.query(`insert into invoices (tenant_id, branch_id, sold_branch_id, patient_id, number, state, is_pkp_at_issue, issued_at, issued_by, issued_as, command_key, created_by, created_as)
        values ($1, $2, $2, $3, 'K17-1', 'issued', false, $4, $5, 'fo_cashier', $6, $5, 'fo_cashier') returning id`, [t.tenantId, t.b1, pid, at("2026-09-01 09:00"), own.staffId, `k17-${key()}`])).rows[0].id;
      const ln = (await h.admin.query(`insert into invoice_lines (tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, line_total, tax_category, tax_basis, vat_base, vat_amount)
        values ($1, $2, $3, $4, $5, 1, 500000, 500000, 'exempt_medical', 'Jasa medis', 500000, 0) returning id`, [t.tenantId, t.b1, i, svc, svcV])).rows[0].id;
      const rule = (await h.admin.query(`insert into commission_rules (tenant_id, contribution_type, name, created_by, created_as, command_key) values ($1, 'performer', 'Aturan uji', $2, 'owner', $3) returning id`,
        [t.tenantId, own.staffId, `cr-${key()}`])).rows[0].id;
      const rv = (await h.admin.query(`insert into commission_rule_versions (tenant_id, rule_id, version, kind, fixed_amount, effective_from, prepared_by, prepared_as, command_key)
        values ($1, $2, 1, 'fixed', 1, '2026-01-01', $3, 'owner', $4) returning id`, [t.tenantId, rule, own.staffId, `crv-${key()}`])).rows[0].id;
      const ent = async (amount: number, accrued: string) => {
        const c = (await h.admin.query(`insert into commission_contributions (tenant_id, branch_id, staff_id, contribution_type, source_kind, source_id, invoice_line_id, rule_version_id, sale_at)
          values ($1, $2, $3, 'performer', 'treatment_execution', gen_random_uuid(), $4, $5, $6) returning id`, [t.tenantId, t.b1, nurse.staffId, ln, rv, at(accrued)])).rows[0].id;
        return (await h.admin.query(`insert into commission_entitlements (tenant_id, branch_id, contribution_id, staff_id, amount, basis, fact_kind, fact_id, accrued_at)
          values ($1, $2, $3, $4, $5, $5, 'execution', gen_random_uuid(), $6) returning id`, [t.tenantId, t.b1, c, nurse.staffId, amount, at(accrued)])).rows[0].id as string;
      };
      const batch = async (state: "approved" | "paid", period: string) => {
        const ap = (await h.admin.query(`insert into approvals (tenant_id, type, subject_kind, subject_id, request_reason, amount_rupiah, state, requested_by, requested_as, decided_by, decided_as, decided_at)
          values ($1, 'commission_batch', 'payout_batch', gen_random_uuid(), 'Uji', 1, 'approved', $2, 'finance', $3, 'owner', now()) returning id`, [t.tenantId, nurse.staffId, own.staffId])).rows[0].id;
        return (await h.admin.query(`insert into payout_batches (tenant_id, period_key, period_start, period_end, closing_day, state, approval_id, submitted_by, submitted_at, paid_by, paid_at, paid_method, created_by, command_key)
          values ($1, $2, $3, $4, 'month_end', $5, $6, $7, now(), case when $5 = 'paid' then $7::uuid end, case when $5 = 'paid' then now() end, case when $5 = 'paid' then 'transfer' end, $7, $8) returning id`,
          [t.tenantId, period, at(`${period}-01 00:00`), at(`${period}-28 00:00`), state, ap, own.staffId, `pb-${key()}`])).rows[0].id as string;
      };
      const paidE = await ent(100_000, "2026-08-10 10:00");        // in a paid batch → not owed
      const apprE = await ent(80_000, "2026-09-10 10:00");         // in an approved batch → owed (approved)
      const octE = await ent(50_000, "2026-10-10 10:00");          // in no batch → owed (accrued), earned in October
      const pb = await batch("paid", "2026-08"); const ab = await batch("approved", "2026-09");
      await h.admin.query(`insert into payout_batch_items (tenant_id, batch_id, staff_id, entitlement_id, amount) values ($1, $2, $3, $4, 100000), ($1, $5, $3, $6, 80000)`,
        [t.tenantId, pb, nurse.staffId, paidE, ab, apprE]);
      await h.admin.query(`insert into commission_adjustments (tenant_id, branch_id, entitlement_id, staff_id, amount, cause, fact_kind, fact_id, after_payout, adjusted_at)
        values ($1, $2, $3, $4, -10000, 'refund', 'refund', gen_random_uuid(), false, $5)`, [t.tenantId, t.b1, octE, nurse.staffId, at("2026-10-20 10:00")]);
    });
    // r3 (review 3ba1bf52 F3): the old assertion excluded the August entitlement because its batch is paid NOW (paid_at = now(), after
    // 2026-10-31) — the reviewed defect. Owed at 2026-10-31 from dated movements: 100,000 + 80,000 + 50,000 − 10,000 = 220,000; no batch
    // line has paid_at <= p_to (this fixture's paid batch has no line, so nothing net is paid yet). The batch states are the current
    // workflow (informational gross rupiah, not owed).
    const r = await as(own, (db) => kpi(db, { kpi: "k17", ...P4 }));
    expect([r.total, r.by_dim]).toEqual([220_000, { accrued: 230_000, adjusted: -10_000 }]);
    expect(r.extra).toMatchObject({ earned_net: 40_000, current_workflow: { paid: 100_000, approved: 80_000, accrued: 40_000, pending_approval: 0 } });
    expect(r.by_grp1[nurse.staffId]).toEqual({ accrued: 230_000, adjusted: -10_000 });
    expect(r.by_grp2.performer).toEqual({ accrued: 230_000, adjusted: -10_000 });
  });

  it("UX-60 homes: each role gets its own home from existing facts; nurse, FO and finance are refused; no clinical text", async () => {
    const fh = await as(FH, (db) => roleHome(db));
    expect(fh).toMatchObject({ home: "klinis", branch_id: A.b1, complaints_open: 0, incidents_open: 0, satusehat_rejected: 0 });
    const ph = await as(await person(A, "pharmacist", A.b1), (db) => roleHome(db));
    expect(ph).toMatchObject({ home: "apotek", branch_id: A.b1, to_prepare: 0, batches_held: { quarantined: 0, recalled: 0 } });
    expect(await as(await person(A, "purchasing", A.b1), (db) => roleHome(db))).toMatchObject({ home: "pembelian", po_open: 0 });
    expect(await as(await person(A, "marketing", A.b1), (db) => roleHome(db))).toMatchObject({ home: "marketing", leads_by_stage: {} });
    const au = await as(await person(A, "auditor"), (db) => roleHome(db));
    // voids: 1 = the invoice voided by the K3 void test above (same tenant, file order)
    expect(au).toMatchObject({ home: "audit", voids: { count: 1 }, write_offs: { count: 0, amount: 0 } });
    for (const r of ["nurse", "finance"] as const) {
      await expect(as(await person(A, r, A.b1), (db) => roleHome(db))).rejects.toSatisfy((e) => code(e) === "ERR_FORBIDDEN");
    }
    await expect(as(FO, (db) => roleHome(db))).rejects.toSatisfy((e) => code(e) === "ERR_FORBIDDEN");
    expect(JSON.stringify([fh, ph, au])).not.toContain("Kondisi rahasia");
  });
});

// ── slice 5: K5, K6, K7, K8, K11, K13, K16, K18 on facts persisted by the real writers (one fresh tenant per KPI so each total is exact),
// each KPI's drill-down rows summing to its total. The writers stamp the wall clock, so the period is yesterday–tomorrow (Asia/Jakarta). ──
describe("T-107 slice 5: persisted equality K5–K8, K11, K13, K16, K18 (real writers) and drill-down sums", () => {
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const shift = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const PER = () => ({ from: shift(today(), -1), to: shift(today(), 1) });
  type W = { t: T; own: P; fh: P; doc: P; fo: P; mgr: P; ph: P; nur: P; svc: string; svcV: string };
  async function world(code: string, price = 500_000): Promise<W> {
    const t = await tenant();
    const own = await person(t, "owner"); const fh = await person(t, "facility_head", t.b1); const doc = await person(t, "doctor", t.b1);
    const fo = await person(t, "fo_cashier", t.b1); const mgr = await person(t, "manager", t.b1); const ph = await person(t, "pharmacist", t.b1);
    const nur = await person(t, "nurse", t.b1);
    await credential(t, doc, t.b1, fh, own);
    const v = await as(own, (db) => publish(db, { kind: "service", code }, {
      name: `Layanan ${code}`, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: price, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat persetujuan.", delegation: "Dokter", aftercare_text: "Perawatan",
      eligibility: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "performs" }],
    } as never, "Layanan baru"));
    if (v.approvalId) await as(fh, (db) => db.query(`select approval_decide($1, true, null)`, [v.approvalId]));
    await as(mgr, (db) => enableMockPort(db));
    return { t, own, fh, doc, fo, mgr, ph, nur, svc: v.itemId, svcV: v.versionId };
  }
  const product = async (w: W, code: string, price: number) =>
    (await as(w.own, (db) => publish(db, { kind: "product", code }, { name: `Produk ${code}`, tax_category: "non_object", tax_basis: "Barang", normal_price: price } as never, "Produk"))).itemId as string;
  // a visit with a signed exam and one plan item (the service), consent captured
  async function treatVisit(w: W, pid: string) {
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [w.t.tenantId, w.t.b1, pid, w.fo.staffId])).rows[0].id as string;
    const { examId } = await as(w.doc, (db) => openExam(db, key(), v));
    const { planId } = await as(w.doc, (db) => createPlan(db, key(), examId, "Program Ringkasan", "Kondisi rahasia"));
    const { itemId } = await as(w.doc, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: w.svcV, qty: 1 }));
    await as(w.doc, (db) => signRecord(db, key(), examId, STEP));
    const ct = await as(w.doc, (db) => consentText(db, v, planId));
    await as(w.doc, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: ct.content_hash, signature: png() }));
    return { v, item: itemId as string };
  }
  // the visit's invoice for these lines, paid in cash
  async function billPaid(w: W, pid: string, v: string | null, lines: { itemId: string; quantity: number; planItemId?: string }[], total: number) {
    const { invoiceId } = await as(w.fo, (db) => openKasirInvoice(db, key(), v ? { patientId: pid, visitId: v } : { patientId: pid }));
    await as(w.fo, (db) => issueKasirInvoice(db, key(), invoiceId, lines));
    await as(w.fo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: total, cashTendered: total }]));
    return invoiceId;
  }
  const drillSum = (r: { rows: { amount: number }[] | null; total: number | null }) => [r.rows!.reduce((a, x) => a + x.amount, 0), r.total];
  const k = (w: W, kpiName: Parameters<typeof kpi>[1]["kpi"], extra: object = {}) => as(w.own, (db) => kpi(db, { kpi: kpiName, ...PER(), detail: true, ...extra }));

  it("K5 Kewajiban prabayar: a balance top-up 300,000 and an unredeemed package paid 1,200,000 (validity 30 days → expiry slice) = 1,500,000", async () => {
    const w = await world("K5-SVC");
    const pv = await as(w.own, (db) => publish(db, { kind: "package", code: "K5-PKT" }, { name: "Paket K5", tax_category: "exempt_medical", tax_basis: "Jasa medis",
      normal_price: 1_200_000, installments_allowed: true, validity_days: 30 } as never, "Paket"));
    await as(w.own, (db) => setPackageContents(db, key(), pv.versionId, [{ serviceItemId: w.svc, count: 3 }]));
    const pid = await patient(w.t, w.t.b1);
    await as(w.fo, (db) => topUpBalance(db, key(), pid, null, { method: "cash", amount: 300_000, cashTendered: 300_000 }));
    await billPaid(w, pid, null, [{ itemId: pv.itemId, quantity: 1 }], 1_200_000);
    const r = await k(w, "k5");
    expect([r.total, r.by_dim]).toEqual([1_500_000, { patient_balance: 300_000, package_liability: 1_200_000, packages_expiring_30: 1_200_000 }]);
    // drill-down: the money rows (not the expiry slice, a sub-view of the package rows) sum to the total
    expect(r.rows!.filter((x) => x.dim !== "packages_expiring_30" && x.dim !== "incomplete").reduce((a, x) => a + x.amount, 0)).toBe(r.total);
  });

  it("K6 Paket kedaluwarsa ke saldo: a package paid 900,000 expires unredeemed (the daily scan) → 900,000 moved to balance at the selling branch; a cancelled package does not count", async () => {
    const w = await world("K6-SVC");
    const pv = await as(w.own, (db) => publish(db, { kind: "package", code: "K6-PKT" }, { name: "Paket K6", tax_category: "exempt_medical", tax_basis: "Jasa medis",
      normal_price: 900_000, installments_allowed: true, validity_days: 30 } as never, "Paket"));
    await as(w.own, (db) => setPackageContents(db, key(), pv.versionId, [{ serviceItemId: w.svc, count: 3 }]));
    const pid = await patient(w.t, w.t.b1); const pid2 = await patient(w.t, w.t.b1);
    const inv = await billPaid(w, pid, null, [{ itemId: pv.itemId, quantity: 1 }], 900_000);
    const inv2 = await billPaid(w, pid2, null, [{ itemId: pv.itemId, quantity: 1 }], 900_000);
    const pk = (await h.admin.query(`select id from packages where invoice_id = $1`, [inv])).rows[0].id as string;
    const pk2 = (await h.admin.query(`select id from packages where invoice_id = $1`, [inv2])).rows[0].id as string;
    await as(w.mgr, (db) => cancelPackage(db, key(), pk2, "Pasien membatalkan paket"));
    // the validity end is fixed at sale (+30 days); the scan runs with a "today" past it (the writer's own expiry path, no row edits)
    expect(await runPackageExpiryScan(worker, shift(today(), 31))).toBeGreaterThanOrEqual(1);
    expect((await h.admin.query(`select state, paid_unused_moved::bigint m from packages where id = $1`, [pk])).rows[0]).toEqual({ state: "expired", m: "900000" });
    const r = await k(w, "k6");
    expect([r.total, r.by_branch, r.rows!.map((x) => x.source_id)]).toEqual([900_000, { [w.t.b1]: { expired_to_balance: 900_000 } }, [pk]]);
    expect(drillSum(r)).toEqual([900_000, 900_000]);
  });

  it("K7 Kontribusi: a counted treatment 500,000 − material cost (moving average) − performer commission 50,000; the bulk-estimated line flags estimasi; a non-bulk visit does not", async () => {
    const w = await world("K7-SVC");
    const r0 = await as(w.own, (db) => createRule(db, key(), { contributionType: "performer", name: "Pelaksana", kind: "fixed", fixedAmount: 50_000 }));
    await as(w.own, (db) => decideRuleVersion(db, r0.versionId, "activate"));
    const mat = async (code: string, name: string) => {
      const cat = (await as(w.own, (db) => publish(db, { kind: "material", code }, { name, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan"))).itemId;
      return (await as(w.ph, (db) => saveItem(db, key(), null, { catalogItemId: cat, unit: "pcs", storage: "ruang", highValue: false, active: true }))).itemId as string;
    };
    const gel = await mat("K7-GEL", "Gel K7"); const cotton = await mat("K7-KPS", "Kapas K7");
    await as(w.ph, (db) => setItemClass(db, key(), cotton, "bulk"));
    const g1 = (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [w.t.b1])).rows[0].id as string;
    const room = (await as(w.ph, (db) => createDepot(db, key(), { branchId: null, name: "Ruang K7", kind: "ruang" }))).depotId;
    const exp = shift(today(), 200);
    await as(w.ph, (db) => receiveCosted(db, key(), null, { itemId: gel, batchNo: "K7-G1", expiry: exp, quantity: "10", reason: "penerimaan", unitCost: 10_000 }));
    await as(w.ph, (db) => receiveCosted(db, key(), null, { itemId: cotton, batchNo: "K7-K1", expiry: exp, quantity: "5", reason: "penerimaan", unitCost: 2_000 }));
    const run = async (lines: { itemId: string; quantity: string }[], use?: { itemId: string; quantity: string }[]) => {
      const pid = await patient(w.t, w.t.b1);
      const { v, item } = await treatVisit(w, pid);
      await billPaid(w, pid, v, [{ itemId: w.svc, quantity: 1 }], 500_000); // an initial plan item is billed by its catalog item (plan_item_id = additions only)
      const { requestId } = await as(w.nur, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: room, planItemId: item, lines }));
      await as(w.ph, (db) => issueMaterials(db, key(), requestId, { fromDepotId: g1 }));
      const e = await as(w.doc, (db) => startTreatment(db, key(), v, { planItemId: item, performerId: w.doc.staffId, identityConfirmed: true }));
      await as(w.nur, (db) => consumeMaterials(db, key(), requestId, use));
      await as(w.doc, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    };
    await run([{ itemId: gel, quantity: "2" }]);                                                  // gel 2 × 10,000 = 20,000, actual
    await run([{ itemId: gel, quantity: "1" }, { itemId: cotton, quantity: "1" }], [{ itemId: gel, quantity: "1" }, { itemId: cotton, quantity: "0.5" }]);
    // the second run: gel 10,000 actual; the bulk cotton is an estimate (no movement, estimated = true)
    const r = await k(w, "k7");
    expect([r.total, r.by_dim]).toEqual([1_000_000 - 30_000 - 100_000, { treatment: 1_000_000, material_cost: -30_000, performer_commission: -100_000, estimasi: 1 }]);
    expect(r.rows!.filter((x) => ["treatment", "material_cost", "product_cost", "performer_commission"].includes(x.dim)).reduce((a, x) => a + x.amount, 0)).toBe(r.total);
  });

  it("K8 Konsultasi jadi pembelian: two consultation visits, one buys a product (fee waived by purchase), one is charged the fee → 1 of 2", async () => {
    const w = await world("K8-SVC");
    await as(w.own, (db) => changeSetting(db, { key: "SET-6", branchId: null, value: 150_000, reason: "Biaya konsultasi" }));
    // the consultation fee is billed on the tenant's consultation service (category consultation)
    const kv = await as(w.own, (db) => publish(db, { kind: "service", code: "K8-KON" }, {
      name: "Konsultasi Dokter", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 99_000, category: "consultation", prep_min: 0, treatment_min: 15,
      buffer_min: 0, indications: "Indikasi", consent_template: "Templat konsultasi.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Layanan baru"));
    if (kv.approvalId) await as(w.fh, (db) => db.query(`select approval_decide($1, true, null)`, [kv.approvalId]));
    const serum = await product(w, "K8-SRM", 333_000);
    const consult = async () => {
      const pid = await patient(w.t, w.t.b1);
      const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
        [w.t.tenantId, w.t.b1, pid, w.fo.staffId])).rows[0].id as string;
      const { examId } = await as(w.doc, (db) => openExam(db, key(), v));
      await as(w.doc, (db) => signRecord(db, key(), examId, STEP));
      return { pid, v };
    };
    const a = await consult();
    await billPaid(w, a.pid, a.v, [{ itemId: serum, quantity: 1 }], 333_000);
    await as(w.fo, (db) => closeVisit(db, key(), a.v));
    const b = await consult();
    const ch = await as(w.fo, (db) => chargeConsultationFee(db, key(), b.v));
    await as(w.fo, (db) => receivePayment(db, key(), ch.invoice_id, [{ method: "cash", amount: ch.amount, cashTendered: ch.amount }]));
    await as(w.fo, (db) => closeVisit(db, key(), b.v));
    const r = await k(w, "k8");
    expect([r.by_dim, r.total]).toEqual([{ consultation: 2, purchase: 1 }, null]);
    expect(new Set(r.rows!.map((x) => x.source_id))).toEqual(new Set([a.v, b.v]));
  });

  it("K11 Kunjungan kedua: three new patients this period; one returns (a second, closed visit) → 1 of 3; a merged duplicate's visit is the survivor's", async () => {
    const w = await world("K11-SVC");
    const p1 = await patient(w.t, w.t.b1); const p2 = await patient(w.t, w.t.b1); const p3 = await patient(w.t, w.t.b1);
    const visit = async (pid: string, closed: boolean) => {
      const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
        [w.t.tenantId, w.t.b1, pid, w.fo.staffId])).rows[0].id as string;
      if (closed) await as(w.fo, (db) => closeVisit(db, key(), v));
      return v;
    };
    await visit(p1, true); await visit(p1, true);   // p1 returns (closed second visit)
    await visit(p2, true);                           // p2 once
    await visit(p3, true); await visit(p3, false);   // p3's second visit still open: not completed
    const r = await k(w, "k11");
    expect([r.by_dim, r.total]).toEqual([{ new: 3, second_visit: 1 }, null]);
    const k10 = await k(w, "k10");
    expect(k10.by_dim).toEqual({ new: 3, returning: 2 });
  });

  it("K13 Konversi lead: three leads by CS (instagram ×2, phone); one booked → arrived → paid, one booked only → by source and assignee", async () => {
    const w = await world("K13-SVC");
    const cs = await person(w.t, "central_cs");
    const appt = async (pid: string) => {
      await h.admin.query(`alter table appointments disable trigger appointments_guard`);
      try {
        return (await h.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
          values ($1, $2, $3, $4, $5, now() + interval '2 hours', now() + interval '150 minutes', 'booked', 'phone', $6, 'fo_cashier') returning id`,
          [w.t.tenantId, w.t.b1, pid, w.svcV, w.doc.staffId, w.fo.staffId])).rows[0].id as string;
      } finally { await h.admin.query(`alter table appointments enable always trigger appointments_guard`); }
    };
    const arrive = async (pid: string, apt: string) => {
      await h.admin.query(`alter table appointments disable trigger appointments_guard`);
      try { await h.admin.query(`update appointments set state = 'arrived', state_changed_at = now(), state_changed_by = $2 where id = $1`, [apt, w.fo.staffId]); }
      finally { await h.admin.query(`alter table appointments enable always trigger appointments_guard`); }
      return (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, appointment_id, kind, checked_in_by) values ($1, $2, $3, $4, 'booked', $5) returning id`,
        [w.t.tenantId, w.t.b1, pid, apt, w.fo.staffId])).rows[0].id as string;
    };
    const serum = await product(w, "K13-SRM", 250_000);
    const p1 = await patient(w.t, w.t.b1); const p2 = await patient(w.t, w.t.b1); const p3 = await patient(w.t, w.t.b1);
    const l1 = (await as(cs, (db) => createLead(db, key(), { source: "instagram", patientId: p1, branchId: w.t.b1 }))).leadId;
    const l2 = (await as(cs, (db) => createLead(db, key(), { source: "instagram", patientId: p2, branchId: w.t.b1 }))).leadId;
    await as(cs, (db) => createLead(db, key(), { source: "phone", patientId: p3, branchId: w.t.b1 })); // whatsapp leads need a conversation
    for (const l of [l1, l2]) await as(cs, (db) => setLeadStage(db, key(), l, { to: "contacted" }));
    const a1 = await appt(p1); await as(cs, (db) => setLeadStage(db, key(), l1, { to: "booked" }));
    await appt(p2); await as(cs, (db) => setLeadStage(db, key(), l2, { to: "booked" }));
    const v1 = await arrive(p1, a1); await as(cs, (db) => setLeadStage(db, key(), l1, { to: "arrived" }));
    await billPaid(w, p1, v1, [{ itemId: serum, quantity: 1 }], 250_000);
    await as(cs, (db) => setLeadStage(db, key(), l1, { to: "converted" }));
    const r = await k(w, "k13");
    expect(r.by_dim).toEqual({ lead: 3, booked: 2, arrived: 1, paid: 1 });
    expect(r.by_grp1).toEqual({ instagram: { lead: 2, booked: 2, arrived: 1, paid: 1 }, phone: { lead: 1 } });
    expect(r.by_grp2).toEqual({ "-": { lead: 3, booked: 2, arrived: 1, paid: 1 } }); // CS leads are unassigned until assigned
  });

  it("K16 Lampiran produk: two treatment visits (counted), one with a product line on its invoice → 1 of 2", async () => {
    const w = await world("K16-SVC");
    const serum = await product(w, "K16-SRM", 200_000);
    const treated = async (withProduct: boolean) => {
      const pid = await patient(w.t, w.t.b1);
      const { v, item } = await treatVisit(w, pid);
      const lines = [{ itemId: w.svc, quantity: 1 }, ...(withProduct ? [{ itemId: serum, quantity: 1 }] : [])];
      await billPaid(w, pid, v, lines, withProduct ? 700_000 : 500_000);
      const e = await as(w.doc, (db) => startTreatment(db, key(), v, { planItemId: item, performerId: w.doc.staffId, identityConfirmed: true }));
      await as(w.doc, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
      return v;
    };
    const va = await treated(true); const vb = await treated(false);
    const r = await k(w, "k16");
    expect(r.by_dim).toEqual({ treatment_visit: 2, with_product: 1 });
    expect(r.rows!.filter((x) => x.dim === "with_product").map((x) => x.source_id)).toEqual([va]);
    void vb;
  });

  it("K18 Risiko stok: an item below its minimum, a batch expiring within SET-27 (30 days), and an applied count with a variance", async () => {
    const w = await world("K18-SVC");
    const it2 = async (code: string) => {
      const cat = (await as(w.own, (db) => publish(db, { kind: "material", code }, { name: `Bahan ${code}`, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan"))).itemId;
      return (await as(w.ph, (db) => saveItem(db, key(), null, { catalogItemId: cat, unit: "pcs", storage: "ruang", highValue: false, active: true }))).itemId as string;
    };
    const low = await it2("K18-LOW"); const ok = await it2("K18-OK");
    await as(w.ph, (db) => receiveCosted(db, key(), null, { itemId: low, batchNo: "L-1", expiry: shift(today(), 10), quantity: "3", reason: "penerimaan", unitCost: 1_000 }));
    await as(w.ph, (db) => receiveCosted(db, key(), null, { itemId: ok, batchNo: "O-1", expiry: shift(today(), 300), quantity: "20", reason: "penerimaan", unitCost: 1_000 }));
    await as(w.ph, (db) => setLevel(db, key(), null, low, "5", "10"));   // 3 fit < 5 → below minimum
    await as(w.ph, (db) => setLevel(db, key(), null, ok, "5", "10"));    // 20 ≥ 5
    const same = await it2("K18-SAME");
    await as(w.ph, (db) => receiveCosted(db, key(), null, { itemId: same, batchNo: "S-1", expiry: shift(today(), 300), quantity: "8", reason: "penerimaan", unitCost: 1_000 }));
    const { countId } = await as(w.ph, (db) => startCount(db, key(), false, [ok, same]));
    const lines = (await as(w.ph, (db) => getCount(db, countId))).lines;
    // `ok` counted 0.5 % below (under the SET-43 2 % threshold → applied, a variance line); `same` counted exactly (no variance)
    for (const l of lines) await as(w.ph, (db) => recordCount(db, key(), countId, l.id, l.item_id === ok ? "19.9" : String(l.system_qty)));
    expect((await as(w.ph, (db) => submitCount(db, key(), countId, "Opname rutin"))).state).toBe("applied");
    const r = await k(w, "k18");
    expect(r.by_dim).toEqual({ below_min: 1, expiring: 1, variance: 1 });
    expect(r.rows!.find((x) => x.dim === "below_min")!.source_id).toBe(low);
  });
});

// ── r3 (independent review 3ba1bf52; Panel 2 PANEL2-R2-REVIEW-DECISION; Sol STOP 2026-11-20): one regression per finding, each on
// dated synthetic facts (the writers stamp clock_timestamp(), so post-cutoff facts are inserted with seedRaw, the slice-4 practice). ──
describe("T-107 r3: review 3ba1bf52 findings", () => {
  const P10 = { from: "2026-10-01", to: "2026-10-31" };
  const at = (local: string) => `${local}+07`; // Asia/Jakarta
  async function seedRaw(tables: string[], fn: () => Promise<void>) {
    const off: [string, string][] = [];
    for (const tb of tables) for (const r of (await h.admin.query(`select tgname from pg_trigger where tgrelid = $1::regclass and not tgisinternal and tgenabled <> 'D'`, [tb])).rows) off.push([tb, r.tgname]);
    for (const [tb, tg] of off) await h.admin.query(`alter table ${tb} disable trigger ${tg}`);
    try { await fn(); } finally { for (const [tb, tg] of off) await h.admin.query(`alter table ${tb} enable always trigger ${tg}`); }
  }
  async function r3world() {
    const t = await tenant();
    const own = await person(t, "owner");
    const svc = (await h.admin.query(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'service', $2, $3) returning id`,
      [t.tenantId, `R3-${String(++n).padStart(4, "0")}`, own.staffId])).rows[0].id as string;
    const svcV = (await h.admin.query(`insert into catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, reason, created_by, created_as)
      values ($1, $2, 1, 'active', 'Layanan R3', 'exempt_medical', 'Jasa medis', 500000, 'Layanan baru', $3, 'owner') returning id`, [t.tenantId, svc, own.staffId])).rows[0].id as string;
    return { t, own, svc, svcV };
  }
  // ── F1: Klinis home credentials — a permit of another branch never shows; an STR shows where its holder has a clinical role ──
  it("F1: Klinis home lists this branch's permits and the STR of a clinician assigned here — never another branch's SIP (two-branch clinician)", async () => {
    const t = await tenant();
    const own = await person(t, "owner"); const fhA = await person(t, "facility_head", t.b1); const fhB = await person(t, "facility_head", t.b2);
    const doc = await person(t, "doctor", t.b1, t.b2);         // clinical at A and B
    const nurseB = await person(t, "nurse", t.b2);             // clinical at B only
    // clinical at B, but at A only as a cashier: the STR stays out of A's clinical home (0068: a clinical role at the branch)
    const mixed = await person(t, "nurse", t.b2);
    const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId: mixed.staffId, role: "fo_cashier" });
    await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: t.b1 });
    const soon = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const cred = async (p: P, kind: string, branch: string | null, no: string) => {
      const id = (await h.admin.query(`insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
        values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`, [t.tenantId, p.staffId, kind, no, branch, soon, own.staffId])).rows[0].id as string;
      await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, fhA.staffId]);
      return id;
    };
    const strDoc = await cred(doc, "str", null, `STR-${n}`); const sipA = await cred(doc, "sip", t.b1, `SIP-A-${n}`); const sipB = await cred(doc, "sip", t.b2, `SIP-B-${n}`);
    const strNurseB = await cred(nurseB, "str", null, `STR-N-${n}`);
    const strMixed = await cred(mixed, "str", null, `STR-M-${n}`);
    const ids = async (p: P) => ((await as(p, (db) => roleHome(db))) as { credentials_expiring: { id: string }[] }).credentials_expiring.map((c) => c.id).sort();
    expect(await ids(fhA)).toEqual([sipA, strDoc].sort());              // B's SIP and B-only nurse's STR excluded
    expect(await ids(fhB)).toEqual([sipB, strDoc, strNurseB, strMixed].sort());   // positive control at B
  });

  // ── F2: K4 at p_to is invariant to later payment, deposit, conversion and cancellation; undated cancellation → incomplete ──
  async function k4Line(w: Awaited<ReturnType<typeof r3world>>, amount: number) {
    const pid = await patient(w.t, w.t.b1);
    let line = "", inv = "", visit = "";
    await seedRaw(["visits", "invoices", "invoice_lines"], async () => {
      visit = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at, closed_at, closed_by)
        values ($1, $2, $3, 'walk_in', $4, $5, $6, $4) returning id`, [w.t.tenantId, w.t.b1, pid, w.own.staffId, at("2026-10-10 09:00"), at("2026-10-10 12:00")])).rows[0].id;
      inv = (await h.admin.query(`insert into invoices (tenant_id, branch_id, sold_branch_id, patient_id, visit_id, number, state, is_pkp_at_issue, issued_at, issued_by, issued_as, command_key, created_by, created_as)
        values ($1, $2, $2, $3, $4, $5, 'issued', false, $6, $7, 'fo_cashier', $8, $7, 'fo_cashier') returning id`,
        [w.t.tenantId, w.t.b1, pid, visit, `R3K4-${key().slice(0, 6)}`, at("2026-10-10 09:30"), w.own.staffId, `r3-${key()}`])).rows[0].id;
      line = (await h.admin.query(`insert into invoice_lines (tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, line_total, tax_category, tax_basis, vat_base, vat_amount)
        values ($1, $2, $3, $4, $5, 1, $6, $6, 'exempt_medical', 'Jasa medis', $6, 0) returning id`, [w.t.tenantId, w.t.b1, inv, w.svc, w.svcV, amount])).rows[0].id;
    });
    return { pid, line, inv, visit };
  }
  const k4 = (p: P) => as(p, (db) => kpi(db, { kpi: "k4", ...P10, detail: true }));
  it("F2: K4 at 2026-10-31 is unchanged by a payment, a deposit application, a conversion and a cancellation dated after it; each counts when dated before", async () => {
    const w = await r3world();
    const L = await Promise.all([k4Line(w, 300_000), k4Line(w, 200_000), k4Line(w, 150_000), k4Line(w, 100_000)]);
    const before = await k4(w.own);
    expect([before.total, before.by_dim, before.extra]).toEqual([750_000, { "0-30": 750_000 }, { undated_cancellations: 0, complete: true }]);
    await seedRaw(["receipts", "payments", "payment_allocations", "appointments", "booking_deposits", "receivables", "receivable_lines", "balance_accounts", "balance_entries",
                   "invoice_lines", "care_plans", "examinations", "plan_items", "treatment_executions"], async () => {
      const q = (sql: string, args: unknown[]) => h.admin.query(sql, args);
      // (1) a payment on line 0 dated 2026-11-05
      const rc = (await q(`insert into receipts (tenant_id, branch_id, invoice_id, number, total, body, paper, command_key, issued_by, issued_as)
        values ($1, $2, $3, $4, 300000, 'Kuitansi sintetis', '80mm', $5, $6, 'fo_cashier') returning id`, [w.t.tenantId, w.t.b1, L[0].inv, `R3R-${key().slice(0, 6)}`, `rr-${key()}`, w.own.staffId])).rows[0].id;
      const pay = (await q(`insert into payments (tenant_id, branch_id, receipt_id, seq, invoice_id, method, amount, cash_tendered, change_given, environment, received_by, received_as, received_at)
        values ($1, $2, $3, 1, $4, 'cash', 300000, 300000, 0, 'local', $5, 'fo_cashier', $6) returning id`, [w.t.tenantId, w.t.b1, rc, L[0].inv, w.own.staffId, at("2026-11-05 10:00")])).rows[0].id;
      await q(`insert into payment_allocations (tenant_id, branch_id, payment_id, invoice_line_id, amount, method, environment, is_simulated, created_at)
        values ($1, $2, $3, $4, 300000, 'cash', 'local', false, $5)`, [w.t.tenantId, w.t.b1, pay, L[0].line, at("2026-11-05 10:00")]);
      // (2) a booking deposit applied to line 1 on 2026-11-06
      const ap = (await q(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
        values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $5, 'fo_cashier') returning id`, [w.t.tenantId, w.t.b1, L[1].pid, w.svcV, w.own.staffId, at("2026-10-10 09:00"), at("2026-10-10 09:30")])).rows[0].id;
      const rc2 = (await q(`insert into receipts (tenant_id, branch_id, invoice_id, number, total, body, paper, command_key, issued_by, issued_as)
        values ($1, $2, $3, $4, 200000, 'Kuitansi DP', '80mm', $5, $6, 'fo_cashier') returning id`, [w.t.tenantId, w.t.b1, L[1].inv, `R3D-${key().slice(0, 6)}`, `rd-${key()}`, w.own.staffId])).rows[0].id;
      await q(`insert into booking_deposits (tenant_id, branch_id, appointment_id, patient_id, catalog_version_id, receipt_id, method, amount, tax_category, is_pkp_at_receipt, vat_base, vat_amount,
               cutoff_hours, state, applied_line_id, decision_code, decided_by, decided_as, decided_at, command_key, received_by, received_as, received_at)
        values ($1, $2, $3, $4, $5, $6, 'cash', 200000, 'exempt_medical', false, 200000, 0, 24, 'applied', $7, 'applied_on_arrival', $8, 'fo_cashier', $9, $10, $8, 'fo_cashier', $11)`,
        [w.t.tenantId, w.t.b1, ap, L[1].pid, w.svcV, rc2, L[1].line, w.own.staffId, at("2026-11-06 10:00"), `dp-${key()}`, at("2026-10-01 10:00")]);
      // (3) line 2 converted to a receivable on 2026-11-07
      const rv = (await q(`insert into receivables (tenant_id, branch_id, patient_id, visit_id, amount, command_key, created_by, created_as, created_at)
        values ($1, $2, $3, $4, 150000, $5, $6, 'fo_cashier', $7) returning id`, [w.t.tenantId, w.t.b1, L[2].pid, L[2].visit, `rv-${key()}`, w.own.staffId, at("2026-11-07 10:00")])).rows[0].id;
      await q(`insert into receivable_lines (tenant_id, branch_id, receivable_id, invoice_line_id, amount) values ($1, $2, $3, $4, 150000)`, [w.t.tenantId, w.t.b1, rv, L[2].line]);
      // (4) line 3 cancelled by an interrupted-to-balance move on 2026-11-08 (the 0121 writer's dated fact: balance_entries from_interrupted_treatment,
      // source = the execution of the line's plan item on this visit)
      const ex = (await q(`insert into examinations (tenant_id, branch_id, visit_id, patient_id, author_id) values ($1, $2, $3, $4, $5) returning id`, [w.t.tenantId, w.t.b1, L[3].visit, L[3].pid, w.own.staffId])).rows[0].id;
      const cp = (await q(`insert into care_plans (tenant_id, branch_id, patient_id, title, condition, created_exam_id, created_by) values ($1, $2, $3, 'Program', 'Kondisi rahasia', $4, $5) returning id`,
        [w.t.tenantId, w.t.b1, L[3].pid, ex, w.own.staffId])).rows[0].id;
      const pi = (await q(`insert into plan_items (tenant_id, branch_id, plan_id, examination_id, stage, catalog_version_id, qty) values ($1, $2, $3, $4, 1, $5, 1) returning id`,
        [w.t.tenantId, w.t.b1, cp, ex, w.svcV])).rows[0].id;
      await q(`update invoice_lines set plan_item_id = $2, cancelled_amount = 100000 where id = $1`, [L[3].line, pi]);
      const e = (await q(`insert into treatment_executions (tenant_id, branch_id, visit_id, plan_item_id, performer_staff_id, identity_confirmed, state, stage, started_at, started_by, started_as,
                          start_command_key, finished_at, finished_by, finished_as, finish_command_key, outcome, stop_reason)
        values ($1, $2, $3, $4, $5, true, 'finished', 'recovery', $6, $5, 'doctor', $7, $8, $5, 'doctor', $9, 'medical_stop', 'Alasan berhenti uji') returning id`,
        [w.t.tenantId, w.t.b1, L[3].visit, pi, w.own.staffId, at("2026-10-10 10:00"), `st-${key()}`, at("2026-10-10 10:20"), `fn-${key()}`])).rows[0].id;
      const acct = (await q(`insert into balance_accounts (tenant_id, patient_id) values ($1, $2) returning id`, [w.t.tenantId, L[3].pid])).rows[0].id;
      await q(`insert into balance_entries (tenant_id, account_id, branch_id, kind, amount, balance_after, source_kind, source_id, command_key, created_by, created_as, created_at)
        values ($1, $2, $3, 'from_interrupted_treatment', 1, 1, 'treatment_execution', $4, $5, $6, 'manager', $7)`, [w.t.tenantId, acct, w.t.b1, e, `bi-${key()}`, w.own.staffId, at("2026-11-08 10:00")]);
    });
    const after = await k4(w.own);
    expect([after.total, after.by_dim, after.extra]).toEqual([before.total, before.by_dim, before.extra]); // history invariant
    // November-end: each later fact counts; the conversion moves 150,000 from the line to the receivable (still owed)
    const nov = await as(w.own, (db) => kpi(db, { kpi: "k4", from: "2026-11-01", to: "2026-11-30" }));
    expect([nov.total, nov.extra]).toEqual([150_000, { undated_cancellations: 0, complete: true }]);
  });
  it("F2 known writer: the real interrupted-to-balance on a half-paid addition dates its cancellation (complete, the line owes 0); a closed visit", async () => {
    const t = await tenant();
    const own = await person(t, "owner"); const fh = await person(t, "facility_head", t.b1); const doc = await person(t, "doctor", t.b1);
    const nur = await person(t, "nurse", t.b1); const fo = await person(t, "fo_cashier", t.b1); const bc = await person(t, "bc", t.b1);
    await credential(t, doc, t.b1, fh, own);
    const svc = await as(own, (db) => publish(db, { kind: "service", code: "R3-INT" }, {
      name: "Layanan Interupsi", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 600_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Baru"));
    if (svc.approvalId) await as(fh, (db) => db.query(`select approval_decide($1, true, null)`, [svc.approvalId]));
    const pid = await patient(t, t.b1);
    const { v, item: baseItem } = await visitWith(t, pid, t.b1, svc.versionId, doc, fo);
    await as(bc, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: baseItem }] }));
    const { invoiceId: first } = await as(fo, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(fo, (db) => issueKasirInvoice(db, key(), first, [{ itemId: svc.itemId, quantity: 1 }]));
    await as(fo, (db) => receivePayment(db, key(), first, [{ method: "cash", amount: 600_000, cashTendered: 600_000 }]));
    const planId = (await h.admin.query(`select plan_id from plan_items where id = $1`, [baseItem])).rows[0].plan_id as string;
    const { requestId } = await as(nur, (db) => createRequest(db, key(), v, { kind: "addition", planId, catalogVersionId: svc.versionId, stage: 1, qty: 1, reason: "Area tambahan" }));
    const addItem = ((await as(doc, (db) => decideRequest(db, key(), requestId, true, null))) as { item_id: string }).item_id;
    const ct = await as(doc, (db) => consentText(db, v, planId));
    await as(doc, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: ct.content_hash, signature: png() }));
    await as(fo, (db) => releaseAddition(db, key(), addItem, fo.staffId));
    const { invoiceId } = await as(fo, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: svc.itemId, quantity: 1, planItemId: addItem }]));
    await as(fo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 250_000, cashTendered: 250_000 }]));
    const e = await as(doc, (db) => startTreatment(db, key(), v, { planItemId: addItem, performerId: doc.staffId, identityConfirmed: true }));
    await as(doc, (db) => finishTreatment(db, key(), e.executionId, { outcome: "medical_stop", reason: "Alasan berhenti uji" }));
    await as(fo, (db) => interruptedToBalance(db, key(), e.executionId));
    expect(Number((await h.admin.query(`select cancelled_amount from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].cancelled_amount)).toBe(350_000);
    await h.admin.query(`update visits set closed_at = now(), closed_by = checked_in_by where id = $1`, [v]);
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    const r = await as(own, (db) => kpi(db, { kpi: "k4", from: day, to: day }));
    expect([r.total, r.extra]).toEqual([null, { undated_cancellations: 0, complete: true }]); // 600,000 − 250,000 paid − 350,000 cancelled = 0
  });

  it("F2 guard: a closed-visit line with a cancellation no dated fact explains makes K4 incomplete — no total, no aging, only the count", async () => {
    const w = await r3world();
    const L = await k4Line(w, 400_000);
    await k4Line(w, 250_000);
    await seedRaw(["invoice_lines"], async () => { await h.admin.query(`update invoice_lines set cancelled_amount = 400000 where id = $1`, [L.line]); });
    const r = await k4(w.own);
    expect([r.total, r.by_dim, r.by_branch, r.extra, r.rows]).toEqual([null, {}, {}, { undated_cancellations: 1, complete: false }, []]);
  });

  // ── F3: K17 owed from dated movements: accrued + adjusted + paid_net (negative, at paid_at); current workflow apart, never summed ──
  it("F3: K17 owed = accrued + adjusted − paid net by date; a batch paid after p_to leaves the October figure unchanged; a carried-forward negative adjustment is not subtracted twice", async () => {
    const w = await r3world();
    const nurse = await person(w.t, "nurse", w.t.b1);
    let batchId = "";
    await seedRaw(["invoices", "invoice_lines", "commission_contributions", "commission_entitlements", "commission_adjustments", "approvals", "payout_batches",
                   "payout_batch_items", "payout_batch_lines"], async () => {
      const q = (sql: string, args: unknown[]) => h.admin.query(sql, args);
      const pid = await patient(w.t, w.t.b1);
      const i = (await q(`insert into invoices (tenant_id, branch_id, sold_branch_id, patient_id, number, state, is_pkp_at_issue, issued_at, issued_by, issued_as, command_key, created_by, created_as)
        values ($1, $2, $2, $3, 'R3K17', 'issued', false, $4, $5, 'fo_cashier', $6, $5, 'fo_cashier') returning id`, [w.t.tenantId, w.t.b1, pid, at("2026-09-01 09:00"), w.own.staffId, `k17-${key()}`])).rows[0].id;
      const ln = (await q(`insert into invoice_lines (tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, line_total, tax_category, tax_basis, vat_base, vat_amount)
        values ($1, $2, $3, $4, $5, 1, 500000, 500000, 'exempt_medical', 'Jasa medis', 500000, 0) returning id`, [w.t.tenantId, w.t.b1, i, w.svc, w.svcV])).rows[0].id;
      const rule = (await q(`insert into commission_rules (tenant_id, contribution_type, name, created_by, created_as, command_key) values ($1, 'performer', 'Aturan R3', $2, 'owner', $3) returning id`,
        [w.t.tenantId, w.own.staffId, `cr-${key()}`])).rows[0].id;
      const rv = (await q(`insert into commission_rule_versions (tenant_id, rule_id, version, kind, fixed_amount, effective_from, prepared_by, prepared_as, command_key)
        values ($1, $2, 1, 'fixed', 1, '2026-01-01', $3, 'owner', $4) returning id`, [w.t.tenantId, rule, w.own.staffId, `crv-${key()}`])).rows[0].id;
      const ent = async (amount: number, accrued: string) => {
        const c = (await q(`insert into commission_contributions (tenant_id, branch_id, staff_id, contribution_type, source_kind, source_id, invoice_line_id, rule_version_id, sale_at)
          values ($1, $2, $3, 'performer', 'treatment_execution', gen_random_uuid(), $4, $5, $6) returning id`, [w.t.tenantId, w.t.b1, nurse.staffId, ln, rv, at(accrued)])).rows[0].id;
        return (await q(`insert into commission_entitlements (tenant_id, branch_id, contribution_id, staff_id, amount, basis, fact_kind, fact_id, accrued_at)
          values ($1, $2, $3, $4, $5, $5, 'execution', gen_random_uuid(), $6) returning id`, [w.t.tenantId, w.t.b1, c, nurse.staffId, amount, at(accrued)])).rows[0].id as string;
      };
      // September: entitlement 100,000 and an adjustment −150,000 → the September batch nets 0 and carries 50,000 forward (paid 2026-10-02)
      const sepE = await ent(100_000, "2026-09-10 10:00");
      const sepA = (await q(`insert into commission_adjustments (tenant_id, branch_id, entitlement_id, staff_id, amount, cause, fact_kind, fact_id, after_payout, adjusted_at)
        values ($1, $2, $3, $4, -150000, 'refund', 'refund', gen_random_uuid(), false, $5) returning id`, [w.t.tenantId, w.t.b1, sepE, nurse.staffId, at("2026-09-20 10:00")])).rows[0].id;
      const batch = async (period: string, paidAt: string) => {
        const ap = (await q(`insert into approvals (tenant_id, type, subject_kind, subject_id, request_reason, amount_rupiah, state, requested_by, requested_as, decided_by, decided_as, decided_at)
          values ($1, 'commission_batch', 'payout_batch', gen_random_uuid(), 'Uji', 1, 'approved', $2, 'finance', $3, 'owner', $4) returning id`, [w.t.tenantId, nurse.staffId, w.own.staffId, at(paidAt)])).rows[0].id;
        return (await q(`insert into payout_batches (tenant_id, period_key, period_start, period_end, closing_day, state, approval_id, submitted_by, submitted_at, paid_by, paid_at, paid_method, created_by, command_key)
          values ($1, $2, $3, $4, 'month_end', 'paid', $5, $6, $7, $6, $7, 'transfer', $6, $8) returning id`,
          [w.t.tenantId, period, at(`${period}-01 00:00`), at(`${period}-28 00:00`), ap, w.own.staffId, at(paidAt), `pb-${key()}`])).rows[0].id as string;
      };
      const sb = await batch("2026-09", "2026-10-02 10:00");
      await q(`insert into payout_batch_items (tenant_id, batch_id, staff_id, entitlement_id, amount) values ($1, $2, $3, $4, 100000)`, [w.t.tenantId, sb, nurse.staffId, sepE]);
      await q(`insert into payout_batch_items (tenant_id, batch_id, staff_id, adjustment_id, amount) values ($1, $2, $3, $4, -150000)`, [w.t.tenantId, sb, nurse.staffId, sepA]);
      await q(`insert into payout_batch_lines (tenant_id, batch_id, staff_id, gross, adjustments, carry_forward_in, net_payable, carry_forward_out) values ($1, $2, $3, 100000, -150000, 0, 0, 50000)`,
        [w.t.tenantId, sb, nurse.staffId]);
      // October: entitlement 200,000 → the October batch nets 200,000 − 50,000 carried in = 150,000, PAID 2026-11-03 (after p_to)
      const octE = await ent(200_000, "2026-10-10 10:00");
      batchId = await batch("2026-10", "2026-11-03 10:00");
      await q(`insert into payout_batch_items (tenant_id, batch_id, staff_id, entitlement_id, amount) values ($1, $2, $3, $4, 200000)`, [w.t.tenantId, batchId, nurse.staffId, octE]);
      await q(`insert into payout_batch_lines (tenant_id, batch_id, staff_id, gross, adjustments, carry_forward_in, net_payable, carry_forward_out) values ($1, $2, $3, 200000, 0, 50000, 150000, 0)`,
        [w.t.tenantId, batchId, nurse.staffId]);
    });
    // at 2026-10-31: accrued 300,000 + adjusted −150,000 + paid_net 0 (the September line paid 0 net) = 150,000 (the October batch is paid later)
    const oct = await as(w.own, (db) => kpi(db, { kpi: "k17", ...P10 }));
    expect([oct.total, oct.by_dim]).toEqual([150_000, { accrued: 300_000, adjusted: -150_000 }]);
    expect(oct.by_grp1[nurse.staffId]).toEqual({ accrued: 300_000, adjusted: -150_000 });
    // the current workflow is informational gross rupiah by today's batch state, never part of owed
    expect((oct.extra as unknown as { current_workflow: Record<string, unknown> }).current_workflow).toMatchObject({ paid: 150_000, accrued: 0, pending_approval: 0, approved: 0 });
    expect((oct.extra as unknown as { earned_net: number }).earned_net).toBe(200_000);
    // at 2026-11-30: + paid_net −150,000 at the October batch's paid_at → owed 0 (the carry-forward is not subtracted again)
    const nov = await as(w.own, (db) => kpi(db, { kpi: "k17", from: "2026-11-01", to: "2026-11-30", detail: true }));
    expect([nov.total, nov.by_dim]).toEqual([0, { accrued: 300_000, adjusted: -150_000, paid_net: -150_000 }]);
    expect(nov.rows!.filter((x) => x.dim === "paid_net").map((x) => [x.day, x.amount, x.source_kind, x.source_id])).toEqual([["2026-11-03", -150_000, "payout_batch", batchId]]);
  });

  // ── F4 + F6: K15 capacity is the branch's performers (idle included), never a cashier's roster; detail rows carry the performer and
  // non-additive source references ──
  it("F4/F6: K15 rostered counts eligible performers only (an idle eligible nurse included, a cashier excluded); rows carry grp1 and refs, minutes once", async () => {
    const w = await r3world();
    const doc = await person(w.t, "doctor", w.t.b1); const nurse = await person(w.t, "nurse", w.t.b1); const fo = await person(w.t, "fo_cashier", w.t.b1);
    const pid = await patient(w.t, w.t.b1);
    let appt = "", shiftDoc = "";
    await seedRaw(["catalog_versions", "branch_services", "service_staff_eligibility", "staff_shifts", "appointments"], async () => {
      const q = (sql: string, args: unknown[]) => h.admin.query(sql, args);
      // r4 (#1): the service is offered at A and in effect on the shift date (booking_eligible per applicable version)
      await q(`update catalog_versions set created_at = '2026-01-01 00:00+07' where id = $1`, [w.svcV]);
      await q(`insert into branch_services (tenant_id, branch_id, item_id) values ($1, $2, $3)`, [w.t.tenantId, w.t.b1, w.svc]);
      for (const role of ["doctor", "nurse"]) await q(`insert into service_staff_eligibility (tenant_id, version_id, role, mode) values ($1, $2, $3, 'performs')`, [w.t.tenantId, w.svcV, role]);
      for (const p of [doc, nurse, fo]) {
        const r = await q(`insert into staff_shifts (tenant_id, branch_id, staff_id, shift_date, starts, ends, kind, created_by) values ($1, $2, $3, '2026-10-14', '09:00', '17:00', 'work', $4) returning id`,
          [w.t.tenantId, w.t.b1, p.staffId, w.own.staffId]);
        if (p === doc) shiftDoc = r.rows[0].id;
      }
      appt = (await q(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
        values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $8, 'fo_cashier') returning id`, [w.t.tenantId, w.t.b1, pid, w.svcV, doc.staffId, at("2026-10-14 10:00"), at("2026-10-14 11:00"), w.own.staffId])).rows[0].id;
    });
    const r = await as(w.own, (db) => kpi(db, { kpi: "k15", from: "2026-10-14", to: "2026-10-14", detail: true }));
    expect(r.extra).toEqual({ covered_minutes: 60, rostered_minutes: 960 }); // doctor 480 + idle nurse 480; the cashier's 480 out
    expect(Object.keys(r.by_grp1).sort()).toEqual([doc.staffId, nurse.staffId].sort());
    const rows = r.rows as unknown as { dim: string; amount: number; grp1: string; refs: { source_kind: string; source_id: string }[] }[];
    const cov = rows.filter((x) => x.dim === "covered");
    expect(cov.map((x) => [x.grp1, x.amount])).toEqual([[doc.staffId, 60]]);
    expect(cov[0].refs).toEqual([{ source_kind: "appointment", source_id: appt }]);
    const ros = rows.filter((x) => x.dim === "rostered" && x.grp1 === doc.staffId);
    expect(ros.map((x) => [x.amount, x.refs])).toEqual([[480, [{ source_kind: "staff_shift", source_id: shiftDoc }]]]);
    expect(rows.reduce((a, x) => a + (x.dim === "covered" ? x.amount : 0), 0)).toBe(60); // refs never add minutes
  });

  // ── F7: K14 compares exact seconds ──
  it("F7: K14 on-time shares compare exact seconds: 15:00 is within 15 minutes, 15:01 is not; SET-20 30 likewise at 30:00 / 30:01", async () => {
    const { t, own } = await r3world();
    await seedRaw(["branch_hours", "setting_versions", "leads"], async () => {
      for (const wd of [0, 1, 2, 3, 4, 5, 6]) await h.admin.query(`insert into branch_hours (tenant_id, branch_id, weekday, opens, closes) values ($1, $2, $3, '09:00', '17:00')`, [t.tenantId, t.b1, wd]);
      await h.admin.query(`insert into setting_versions (tenant_id, key, value, effective_from, state, changed_by, changed_as, changed_name, reason)
        values ($1, 'SET-20', '30'::jsonb, '2026-01-01', 'active', $2, 'owner', 'Pemilik', 'SLA uji')`, [t.tenantId, own.staffId]);
      const lead = (created: string, resp: string) => h.admin.query(
        `insert into leads (tenant_id, branch_id, source, stage, first_response_at, contacted_at, created_by, created_as, command_key, created_at)
         values ($1, $2, 'instagram', 'contacted', $3, $3, $4, 'central_cs', $5, $6)`, [t.tenantId, t.b1, at(resp), own.staffId, `ld-${key()}`, at(created)]);
      await lead("2026-10-01 10:00:00", "2026-10-01 10:15:00");
      await lead("2026-10-02 10:00:00", "2026-10-02 10:15:01");
      await lead("2026-10-03 10:00:00", "2026-10-03 10:30:00");
      await lead("2026-10-04 10:00:00", "2026-10-04 10:30:01");
    });
    const r = await as(own, (db) => kpi(db, { kpi: "k14", ...P10 }));
    expect(r.extra).toMatchObject({ leads: 4, answered: 4, within_15m: 1, within_sla: 3 });
  });

  // ── F5: Marketing home carries K13 (source) and K14 (response) for a stated window ──
  it("F5: Marketing home has the month-to-date window, K13 by source and K14 response — equal to dashboard_kpi for the same window", async () => {
    const { t, own } = await r3world();
    const mk = await person(t, "marketing");
    await seedRaw(["leads"], async () => {
      // contacted leads carry their response (the leads CHECK); a booked stage needs a patient, appointment and visit — the K13 stage
      // counts come from the same reader either way, so the source split is what this test pins
      const lead = (src: string, contacted: boolean) => h.admin.query(
        `insert into leads (tenant_id, branch_id, source, stage, first_response_at, contacted_at, created_by, created_as, command_key) values ($1, $2, $3, $4, $5, $5, $6, 'central_cs', $7)`,
        [t.tenantId, t.b1, src, contacted ? "contacted" : "new", contacted ? new Date() : null, own.staffId, `ld-${key()}`]);
      await lead("instagram", true); await lead("instagram", false); await lead("ads", false);
    });
    const home = (await as(mk, (db) => roleHome(db))) as unknown as { window: { from: string; to: string }; k13: Record<string, unknown>; k14: Record<string, unknown> };
    const k13 = await as(mk, (db) => kpi(db, { kpi: "k13", from: home.window.from, to: home.window.to }));
    expect(home.k13).toEqual({ lead: 3, booked: 0, arrived: 0, paid: 0, by_source: { instagram: { lead: 2 }, ads: { lead: 1 } } });
    expect(k13.by_dim).toEqual({ lead: 3 });
    const k14 = await as(mk, (db) => kpi(db, { kpi: "k14", from: home.window.from, to: home.window.to }));
    expect(home.k14).toEqual(k14.extra);
  });
  // ── r4 (independent re-review 3dcdb005; Panel 2 PANEL2-R3-REVIEW-DECISION) ──
  // #1 K15: capacity = staff booking_eligible (0061) on a service version IN EFFECT on the shift date, of an item the branch offers.
  it("r4 #1: K15 capacity follows booking_eligible per applicable version — a named assistant out, assist-here/eligible-there in, the version in effect on the day", async () => {
    const t = await tenant();
    const own = await person(t, "owner");
    const docAssist = await person(t, "doctor", t.b1);  // role-eligible on A v2, but named `assists` there → out
    const docMixed = await person(t, "doctor", t.b1);   // named `assists` on A v2, named `performs` on B → in
    const docIdle = await person(t, "doctor", t.b1);    // role-eligible on A v2, no appointment → in from 2026-10-01
    const thrAssist = await person(t, "therapist", t.b1); // only ever `assists` → out
    const nurseOld = await person(t, "nurse", t.b1);    // named `performs` on A v1 only (in effect until 2026-10-01)
    const nurseC = await person(t, "nurse", t.b1);      // named `performs` on C, which branch A does not offer → out
    const item = async (code: string) => (await h.admin.query(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'service', $2, $3) returning id`,
      [t.tenantId, `${code}${String(++n).padStart(4, "0")}`, own.staffId])).rows[0].id as string;
    const A = await item("R4A"); const B = await item("R4B"); const C = await item("R4C");
    let aV1 = "", aV2 = "", bV1 = "", cV1 = "";
    await seedRaw(["catalog_versions", "service_staff_eligibility", "branch_services", "staff_shifts"], async () => {
      const q = (sql: string, args: unknown[]) => h.admin.query(sql, args);
      const ver = async (it: string, v: number, state: string, created: string) => (await q(
        `insert into catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, reason, created_by, created_as, category, created_at)
         values ($1, $2, $3, $4, 'Layanan R4', 'exempt_medical', 'Jasa medis', 500000, 'Layanan baru', $5, 'owner', 'facial', $6) returning id`,
        [t.tenantId, it, v, state, own.staffId, at(created)])).rows[0].id as string;
      aV1 = await ver(A, 1, "superseded", "2026-09-01 08:00"); aV2 = await ver(A, 2, "active", "2026-10-01 08:00");
      bV1 = await ver(B, 1, "active", "2026-09-01 08:00"); cV1 = await ver(C, 1, "active", "2026-09-01 08:00");
      const el = (v: string, role: string | null, staff: string | null, mode: string) =>
        q(`insert into service_staff_eligibility (tenant_id, version_id, role, staff_id, mode) values ($1, $2, $3, $4, $5)`, [t.tenantId, v, role, staff, mode]);
      await el(aV1, null, nurseOld.staffId, "performs");
      await el(aV2, "doctor", null, "performs");
      await el(aV2, null, docAssist.staffId, "assists");
      await el(aV2, null, docMixed.staffId, "assists");
      await el(aV2, null, thrAssist.staffId, "assists");
      await el(bV1, null, docMixed.staffId, "performs");
      await el(cV1, null, nurseC.staffId, "performs");
      for (const it of [A, B]) await q(`insert into branch_services (tenant_id, branch_id, item_id) values ($1, $2, $3)`, [t.tenantId, t.b1, it]);
      await q(`insert into branch_services (tenant_id, branch_id, item_id) values ($1, $2, $3)`, [t.tenantId, t.b2, C]); // C offered at B only
      for (const d of ["2026-09-15", "2026-10-14"]) for (const p of [docAssist, docMixed, docIdle, thrAssist, nurseOld, nurseC])
        await q(`insert into staff_shifts (tenant_id, branch_id, staff_id, shift_date, starts, ends, kind, created_by) values ($1, $2, $3, $4, '09:00', '17:00', 'work', $5)`,
          [t.tenantId, t.b1, p.staffId, d, own.staffId]);
    });
    const roster = async (d: string) => {
      const r = await as(own, (db) => kpi(db, { kpi: "k15", from: d, to: d }));
      return [(r.extra as { rostered_minutes: number }).rostered_minutes, Object.keys(r.by_grp1).sort()];
    };
    // 2026-10-14: A v2 + B in effect → docMixed (via B) and idle docIdle (role row); docAssist / thrAssist named assists, nurseOld's v1 is
    // superseded, nurseC's C is not offered here
    expect(await roster("2026-10-14")).toEqual([960, [docMixed.staffId, docIdle.staffId].sort()]);
    // 2026-09-15: A v1 + B in effect → nurseOld (A v1) and docMixed (B); A v2's role row is not yet in effect, so docIdle and docAssist out
    expect(await roster("2026-09-15")).toEqual([960, [docMixed.staffId, nurseOld.staffId].sort()]);
  });

  // #2 K14: lossless thresholds — exact, fractional-over and whole-second-over for both; public detail amount stays in seconds
  it("r4 #2: K14 compares lossless elapsed time: 15:00 in, 15:00.1 out, 15:01 out; SET-20 30 likewise; detail amount in seconds (fractional kept)", async () => {
    const { t, own } = await r3world();
    const ids: Record<string, string> = {};
    await seedRaw(["branch_hours", "setting_versions", "leads"], async () => {
      for (const wd of [0, 1, 2, 3, 4, 5, 6]) await h.admin.query(`insert into branch_hours (tenant_id, branch_id, weekday, opens, closes) values ($1, $2, $3, '09:00', '17:00')`, [t.tenantId, t.b1, wd]);
      await h.admin.query(`insert into setting_versions (tenant_id, key, value, effective_from, state, changed_by, changed_as, changed_name, reason)
        values ($1, 'SET-20', '30'::jsonb, '2026-01-01', 'active', $2, 'owner', 'Pemilik', 'SLA uji')`, [t.tenantId, own.staffId]);
      const lead = async (name: string, day: string, resp: string) => { ids[name] = (await h.admin.query(
        `insert into leads (tenant_id, branch_id, source, stage, first_response_at, contacted_at, created_by, created_as, command_key, created_at)
         values ($1, $2, 'instagram', 'contacted', $3, $3, $4, 'central_cs', $5, $6) returning id`,
        [t.tenantId, t.b1, at(`2026-10-${day} ${resp}`), own.staffId, `ld-${key()}`, at(`2026-10-${day} 10:00:00`)])).rows[0].id; };
      await lead("e15", "01", "10:15:00");     await lead("f15", "02", "10:15:00.1");  await lead("w15", "03", "10:15:01");
      await lead("e30", "04", "10:30:00");     await lead("f30", "05", "10:30:00.1");  await lead("w30", "06", "10:30:01");
    });
    const r = await as(own, (db) => kpi(db, { kpi: "k14", ...P10, detail: true }));
    // within 15: only e15; within SET-20 30: e15, f15, w15, e30 (f30 and w30 are over)
    expect(r.extra).toMatchObject({ leads: 6, answered: 6, within_15m: 1, within_sla: 4 });
    const sec = Object.fromEntries(r.rows!.map((x) => [x.source_id, x.amount]));
    expect(Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, sec[id]]))).toEqual({ e15: 900, f15: 900.1, w15: 901, e30: 1800, f30: 1800.1, w30: 1801 });
    expect(r.by_dim).toEqual({ answered: 8102.2 }); // 900 + 900.1 + 901 + 1800 + 1800.1 + 1801 seconds, as documented
  });

  // #3 Marketing: the SLA count is labelled by the threshold in effect when each lead entered (sla_mix), never today's SET-20
  it("r4 #3: K14 sla_mix splits the SLA count by the SET-20 in effect at entry; the Marketing tile labels it so (today's value is not the label)", async () => {
    const { t, own } = await r3world();
    await seedRaw(["branch_hours", "setting_versions", "leads"], async () => {
      for (const wd of [0, 1, 2, 3, 4, 5, 6]) await h.admin.query(`insert into branch_hours (tenant_id, branch_id, weekday, opens, closes) values ($1, $2, $3, '09:00', '17:00')`, [t.tenantId, t.b1, wd]);
      // SET-20 15 until 2026-10-10, then 30
      for (const [v, from] of [["15", "2026-01-01"], ["30", "2026-10-10"]]) await h.admin.query(`insert into setting_versions (tenant_id, key, value, effective_from, state, changed_by, changed_as, changed_name, reason)
        values ($1, 'SET-20', $2::jsonb, $3, 'active', $4, 'owner', 'Pemilik', 'SLA uji')`, [t.tenantId, v, at(`${from} 00:00`), own.staffId]);
      const lead = (created: string, resp: string | null) => h.admin.query(
        `insert into leads (tenant_id, branch_id, source, stage, first_response_at, contacted_at, created_by, created_as, command_key, created_at)
         values ($1, $2, 'instagram', $3, $4, $4, $5, 'central_cs', $6, $7)`,
        [t.tenantId, t.b1, resp ? "contacted" : "new", resp ? at(resp) : null, own.staffId, `ld-${key()}`, at(created)]);
      await lead("2026-10-05 10:00", "2026-10-05 10:20"); // 20 min under SLA 15 → late
      await lead("2026-10-06 10:00", "2026-10-06 10:10"); // 10 min under SLA 15 → on time (and within 15)
      await lead("2026-10-12 10:00", "2026-10-12 10:20"); // 20 min under SLA 30 → on time
      await lead("2026-10-13 10:00", null);               // unanswered under SLA 30
    });
    const r = await as(own, (db) => kpi(db, { kpi: "k14", ...P10 }));
    const x = r.extra as unknown as K14Extra & { sla_mix: { minutes: number; leads: number; within: number }[] };
    expect(x).toMatchObject({ leads: 4, answered: 3, within_15m: 1, within_sla: 2, sla_minutes: 30 });
    expect(x.sla_mix).toEqual([{ minutes: 15, leads: 2, within: 1 }, { minutes: 30, leads: 2, within: 1 }]);
    // the tile: no "≤ 30 menit" label on the historical count; the per-threshold split is shown; the fixed 15-minute count stays
    const home = (k14: K14Extra) => ({ home: "marketing", branch_id: null, today: "2026-10-31", month_from: "2026-10-01", window: P10, leads_by_stage: {}, dormant_patients: 0,
      k13: { lead: 0, booked: 0, arrived: 0, paid: 0, by_source: {} }, k14, promo_this_month: [], surveys_this_month: { count: 0, average: null, low: 0 } }) as unknown as MarketingHome;
    const text = (k14: K14Extra) => renderToStaticMarkup(createElement(RoleHomeView, { data: home(k14) })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const html = text(x);
    expect(html).not.toMatch(/≤ 30 menit/);
    expect(html).toMatch(/Dijawab sesuai SLA saat lead masuk 2 SLA 15 menit: 1 dari 2 · SLA 30 menit: 1 dari 2/);
    expect(html).toMatch(/Dijawab ≤ 15 menit 1 dari 4 lead/);
    // the empty state is kept
    expect(text({ leads: 0, answered: 0, median_minutes: null, within_15m: 0, within_sla: 0, sla_minutes: 30, sla_mix: [] } as K14Extra)).toMatch(/Belum ada lead pada jam buka di periode ini/);
  });
});

// ── K9 windows / value and K10 returning on the reader (dashboard_kpi, 0126 settled semantics; no DRAFT KPI): the fixture's own facts
// (F.visits, F.plans, month 2026-10) persisted as dated rows with seedRaw (the writers stamp clock_timestamp()), one fresh tenant, every
// value priced at the fixture's value as the catalog normal price (qty 1). The reader must equal the reference calculator K9 / K10. ──
describe("T-107 K9 windows and K10 returning on the reader (fixture facts, real PostgreSQL)", () => {
  const MONTH_P = { from: "2026-10-01", to: "2026-10-31" };
  const at = (local: string) => `${local}+07`; // Asia/Jakarta
  async function seedRaw(tables: string[], fn: () => Promise<void>) {
    const off: [string, string][] = [];
    for (const tb of tables) for (const r of (await h.admin.query(`select tgname from pg_trigger where tgrelid = $1::regclass and not tgisinternal and tgenabled <> 'D'`, [tb])).rows) off.push([tb, r.tgname]);
    for (const [tb, tg] of off) await h.admin.query(`alter table ${tb} disable trigger ${tg}`);
    try { await fn(); } finally { for (const [tb, tg] of off) await h.admin.query(`alter table ${tb} enable always trigger ${tg}`); }
  }
  let W: { t: T; own: P; mgr: P } | undefined;
  let seeding: Promise<{ t: T; own: P; mgr: P }> | undefined;
  const fixtureWorld = () => (seeding ??= seedWorld()); // seeded once, also when the first test fails after seeding
  async function seedWorld() {
    if (W) return W;
    const t = await tenant();
    const own = await person(t, "owner"); const mgr = await person(t, "manager", t.b1); const doc = await person(t, "doctor", t.b1, t.b2);
    const br = (b: Branch) => (b === "A" ? t.b1 : t.b2);
    const pids = new Map<string, string>();
    for (const p of [...new Set(F.visits.map((v) => v.patient))]) pids.set(p, await patient(t, t.b1));
    const version = async (price: number) => {
      const item = (await h.admin.query(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'service', $2, $3) returning id`,
        [t.tenantId, `K9-${String(++n).padStart(4, "0")}`, own.staffId])).rows[0].id as string;
      return (await h.admin.query(`insert into catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, reason, created_by, created_as, created_at)
        values ($1, $2, 1, 'active', 'Layanan K9', 'exempt_medical', 'Jasa medis', $3, 'Layanan baru', $4, 'owner', $5) returning id`,
        [t.tenantId, item, price, own.staffId, at("2026-01-01 00:00")])).rows[0].id as string;
    };
    await seedRaw(["visits", "examinations", "care_plans", "plan_items", "selections", "selection_items"], async () => {
      // every fixture visit, closed the same day (K10 counts visits by check-in day; P5's June visit makes October's V7 returning)
      const visits = new Map<string, string>();
      for (const v of F.visits) visits.set(v.id, (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at, closed_at, closed_by)
        values ($1, $2, $3, 'walk_in', $4, $5, $6, $4) returning id`, [t.tenantId, br(v.branch), pids.get(v.patient), own.staffId, at(`${v.day} 09:00`), at(`${v.day} 17:00`)])).rows[0].id as string);
      // the plan items of the fixture, recommended on their day at their visit; a selection confirmed on a later day sits on a later visit of
      // the same patient (one selection per visit, selections_visit_key), checked in that day — outside October, so K10 is unchanged
      const exams = new Map<string, { ex: string; cp: string }>(); // one examination per visit (examinations_tenant_visit_key), one plan
      for (const p of F.plans) {
        const v = F.visits.find((x) => x.id === p.visit)!;
        if (!exams.has(v.id)) {
          const ex = (await h.admin.query(`insert into examinations (tenant_id, branch_id, visit_id, patient_id, author_id, created_at) values ($1, $2, $3, $4, $5, $6) returning id`,
            [t.tenantId, br(p.branch), visits.get(v.id), pids.get(v.patient), doc.staffId, at(`${p.recommendedDay} 10:00`)])).rows[0].id as string;
          const cp = (await h.admin.query(`insert into care_plans (tenant_id, branch_id, patient_id, title, condition, created_exam_id, created_by) values ($1, $2, $3, 'Program K9', 'Kondisi rahasia', $4, $5) returning id`,
            [t.tenantId, br(p.branch), pids.get(v.patient), ex, doc.staffId])).rows[0].id as string;
          exams.set(v.id, { ex, cp });
        }
        const { ex, cp } = exams.get(v.id)!;
        const cv = await version(p.value);
        const pi = (await h.admin.query(`insert into plan_items (tenant_id, branch_id, plan_id, examination_id, stage, catalog_version_id, qty, created_at) values ($1, $2, $3, $4, 1, $5, 1, $6) returning id`,
          [t.tenantId, br(p.branch), cp, ex, cv, at(`${p.recommendedDay} 10:30`)])).rows[0].id;
        if (!p.selectedDay) continue;
        const sv = p.selectedDay === p.recommendedDay ? visits.get(v.id)! : (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at, closed_at, closed_by)
          values ($1, $2, $3, 'walk_in', $4, $5, $6, $4) returning id`, [t.tenantId, br(p.branch), pids.get(v.patient), own.staffId, at(`${p.selectedDay} 09:00`), at(`${p.selectedDay} 17:00`)])).rows[0].id as string;
        const s = (await h.admin.query(`insert into selections (tenant_id, branch_id, visit_id, patient_id, command_key, confirmed_at, confirmed_by, confirmed_as)
          values ($1, $2, $3, $4, $5, $6, $7, 'doctor') returning id`, [t.tenantId, br(p.branch), sv, pids.get(v.patient), `k9-${key()}`, at(`${p.selectedDay} 11:00`), doc.staffId])).rows[0].id;
        await h.admin.query(`insert into selection_items (tenant_id, branch_id, visit_id, selection_id, kind, plan_item_id, catalog_version_id, quantity) values ($1, $2, $3, $4, 'service', $5, $6, 1)`,
          [t.tenantId, br(p.branch), sv, s, pi, cv]);
      }
    });
    W = { t, own, mgr };
    return W;
  }

  it("K9 on the reader equals the fixture: within 30 days 1 of 3 (1,500,000 of 2,566,000), within 60 and 90 days 2 of 3 (2,166,000)", async () => {
    const { own } = await fixtureWorld();
    const r = await as(own, (db) => kpi(db, { kpi: "k9", ...MONTH_P }));
    const [c30, c60, c90] = [K9(30), K9(60), K9(90)];
    expect(r.by_dim).toEqual({
      recommended_count: c30.count[1], recommended_value: c30.value[1],
      selected_30_count: c30.count[0], selected_30_value: c30.value[0],
      selected_60_count: c60.count[0], selected_60_value: c60.value[0],
      selected_90_count: c90.count[0], selected_90_value: c90.value[0],
    });
    // the literal fixture numbers, so a calculator change cannot silently move both sides
    expect(r.by_dim).toMatchObject({ recommended_count: 3, recommended_value: 2_566_000, selected_30_count: 1, selected_30_value: 1_500_000, selected_60_value: 2_166_000 });
    expect(r.total).toBeNull(); // counts and values read through by_dim; no money total
  });

  it("K10 on the reader equals the fixture: 4 new (P1–P4) and 2 returning (P2's second visit; P5 first seen in June) in October", async () => {
    const { own, mgr, t } = await fixtureWorld();
    const r = await as(own, (db) => kpi(db, { kpi: "k10", ...MONTH_P }));
    expect(r.by_dim).toEqual(K10());
    expect(r.by_dim).toEqual({ new: 4, returning: 2 });
    // per visit branch: V7 (P5's October visit) is returning at B; the manager of A sees only A's 4 new + 1 returning
    expect(r.by_branch).toEqual({ [t.b1]: { new: 4, returning: 1 }, [t.b2]: { returning: 1 } });
    expect((await as(mgr, (db) => kpi(db, { kpi: "k10", ...MONTH_P }))).by_dim).toEqual({ new: 4, returning: 1 });
  });
});

// ── K19 reader parity (D-07, target_closing_value 0103:151; T-107 fixture correction): the fixture's BC1 October money month through the
// real writers — four sales BC1 closes (S1 serum 333,000 + sunscreen 222,000, S2 1,500,000, S3a 400,000, S11 package 3,000,000), the S15b
// serum refund 333,000 (a paid cash refund exception) and the S4a consultation 150,000 BC1 is attributed on — then target_list (owner) and
// target_mine (BC1) for the current WIB month equal the reference calculator K19 above (5,122,000 of 6,000,000 = 8,536 bps). Every
// inclusion input is a real row: the active attribution names BC1, the line scope has closing_bc, the consultation invoice is flagged, the
// refund is paid. plans_actual is not asserted (no grounded fixture fact). ──
describe("T-107 K19 reader parity: target_list / target_mine equal the D-07 closing value of the fixture month", () => {
  // R3 a95ae3d1: the writers stamp the database clock and the readers window one WIB month, so a month turn during the seed would split the
  // facts. The authoritative WIB month is read from PostgreSQL right before the first money write and again after the last one; a change
  // is retried ONCE on a fresh synthetic tenant, a second change fails clearly. Only a detected month change is retried — a writer error or
  // an assertion is never caught here. Both readers are asked for the captured month.
  const WIB_MONTH_SQL = `select to_char(coalesce($1::timestamptz, clock_timestamp()) at time zone 'Asia/Jakarta', 'YYYY-MM') as m`;
  const dbWibMonth = async (at: Date | null = null) => (await h.admin.query<{ m: string }>(WIB_MONTH_SQL, [at])).rows[0].m;
  async function seedInOneWibMonth<R>(seed: () => Promise<{ before: () => Promise<void>; money: () => Promise<R> }>,
    month: () => Promise<string>): Promise<{ month: string; out: R; attempts: number }> {
    const seen: string[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const s = await seed(); // a fresh synthetic tenant and its catalog (no money yet)
      await s.before();
      const m0 = await month();
      const out = await s.money(); // every payment, refund and consultation fee the readers window
      const m1 = await month();
      if (m0 === m1) return { month: m0, out, attempts: attempt };
      seen.push(`${m0}→${m1}`);
    }
    throw new Error(`K19 parity: the WIB month changed during the seed on both attempts (${seen.join(", ")}); rerun away from a month turn`);
  }

  it("the rollover guard: one attempt when the month holds, one retry on a fresh seed after a turn, a clear failure after two, and a writer error is never retried", async () => {
    // the authoritative month is the database's WIB month of an instant: it turns at 17:00 UTC on the last day
    expect([await dbWibMonth(new Date("2026-10-31T16:59:59Z")), await dbWibMonth(new Date("2026-10-31T17:00:00Z"))]).toEqual(["2026-10", "2026-11"]);
    const months = (...xs: string[]) => { const q = [...xs]; return async () => q.shift()!; };
    let seeds = 0;
    const seed = async () => { const n0 = ++seeds; return { before: async () => {}, money: async () => n0 }; };
    expect(await seedInOneWibMonth(seed, months("2026-10", "2026-10"))).toEqual({ month: "2026-10", out: 1, attempts: 1 });
    seeds = 0;
    expect(await seedInOneWibMonth(seed, months("2026-10", "2026-11", "2026-11", "2026-11"))).toEqual({ month: "2026-11", out: 2, attempts: 2 });
    seeds = 0;
    await expect(seedInOneWibMonth(seed, months("2026-10", "2026-11", "2026-11", "2026-12"))).rejects.toThrow(/WIB month changed during the seed on both attempts \(2026-10→2026-11, 2026-11→2026-12\)/);
    expect(seeds).toBe(2);
    let calls = 0;
    const failing = async () => ({ before: async () => {}, money: async () => { calls++; throw new Error("writer refused"); } });
    await expect(seedInOneWibMonth(failing, months("2026-10", "2026-10", "2026-10", "2026-10"))).rejects.toThrow("writer refused");
    expect(calls).toBe(1);
  });

  it("BC1: closing 5,122,000, attainment 8,536 bps on both readers; the consultation and the refund are the deciding inputs; BC3 0", async () => {
    const { month: period, out: x } = await seedInOneWibMonth(async () => {
    const w = { t: await tenant() } as { t: T };
    const own = await person(w.t, "owner"); const fh = await person(w.t, "facility_head", w.t.b1); const doc = await person(w.t, "doctor", w.t.b1);
    const fo = await person(w.t, "fo_cashier", w.t.b1); const mgr = await person(w.t, "manager", w.t.b1);
    const bc1 = await person(w.t, "bc", w.t.b1); const bc3 = await person(w.t, "bc", w.t.b2);
    await credential(w.t, doc, w.t.b1, fh, own);
    await as(mgr, (db) => enableMockPort(db));
    const pub = async (kind: "service" | "product" | "package", code: string, price: number, extra: object = {}) => {
      const v = await as(own, (db) => publish(db, { kind, code }, (kind === "service" ? {
        name: `Layanan ${code}`, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: price, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
        indications: "Indikasi", consent_template: "Templat persetujuan.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }], ...extra,
      } : kind === "product" ? { name: `Produk ${code}`, tax_category: "non_object", tax_basis: "Barang", normal_price: price }
        : { name: `Paket ${code}`, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: price, installments_allowed: true }) as never, "Baru"));
      if (v.approvalId) await as(fh, (db) => db.query(`select approval_decide($1, true, null)`, [v.approvalId]));
      return v;
    };
    const s2 = await pub("service", "K19-S2", 1_500_000); const s3 = await pub("service", "K19-S3", 400_000);
    const serum = await pub("product", "K19-SRM", 333_000); const sun = await pub("product", "K19-SUN", 222_000);
    const pkg = await pub("package", "K19-PKG", 3_000_000);
    await as(own, (db) => setPackageContents(db, key(), pkg.versionId, [{ serviceItemId: s2.itemId, count: 5 }]));
    await pub("service", "K19-KON", 99_000, { category: "consultation", treatment_min: 15, prep_min: 0, buffer_min: 0 });
    await as(own, (db) => changeSetting(db, { key: "SET-6", branchId: null, value: 150_000, reason: "Biaya konsultasi" }));
    return { before: async () => {}, money: async () => {
    // a sale BC1 closes: issued, paid in full by a real (non-simulated) tender, then attributed to BC1 as closing BC
    const sale = async (lines: { itemId: string; quantity: number }[], total: number) => {
      const pid = await patient(w.t, w.t.b1);
      const { invoiceId } = await as(fo, (db) => openKasirInvoice(db, key(), { patientId: pid }));
      await as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, lines));
      await as(fo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: total, cashTendered: total }]));
      await as(fo, (db) => attributeSale(db, key(), invoiceId, { closingBcId: bc1.staffId }));
      return invoiceId;
    };
    const s1 = await sale([{ itemId: serum.itemId, quantity: 1 }, { itemId: sun.itemId, quantity: 1 }], 555_000);
    await sale([{ itemId: s2.itemId, quantity: 1 }], 1_500_000);
    await sale([{ itemId: s3.itemId, quantity: 1 }], 400_000);
    await sale([{ itemId: pkg.itemId, quantity: 1 }], 3_000_000);
    // S15b: the serum line refunded in cash (an owner-approved exception), paid this month
    const serumLine = (await h.admin.query(`select l.id from invoice_lines l where l.invoice_id = $1 and l.item_id = $2`, [s1, serum.itemId])).rows[0].id as string;
    const rf = await as(fo, (db) => requestRefund(db, key(), serumLine, { amount: 333_000, reason: "Serum dikembalikan", destination: "cash" }));
    if (rf.approval_id) await as(own, (db) => decideApproval(db, rf.approval_id!, true));
    if ((await h.admin.query(`select state from refunds where id = $1`, [rf.refund_id])).rows[0].state !== "paid") await as(fo, (db) => payRefund(db, key(), rf.refund_id, "cash"));
    // S4a: a consultation fee charged and paid on a consultation visit, attributed to BC1 — not closing value (NOT invoices.consultation)
    const cpid = await patient(w.t, w.t.b1);
    const cv = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [w.t.tenantId, w.t.b1, cpid, fo.staffId])).rows[0].id as string;
    const { examId } = await as(doc, (db) => openExam(db, key(), cv));
    await as(doc, (db) => signRecord(db, key(), examId, STEP));
    const ch = await as(fo, (db) => chargeConsultationFee(db, key(), cv));
    await as(fo, (db) => receivePayment(db, key(), ch.invoice_id, [{ method: "cash", amount: ch.amount, cashTendered: ch.amount }]));
    await as(fo, (db) => attributeSale(db, key(), ch.invoice_id, { closingBcId: bc1.staffId }));
    return { w, own, bc1, bc3, rf };
    } };
    }, () => dbWibMonth());
    const { w, own, bc1, bc3, rf } = x;
    // the inclusion inputs are real rows, not assumed
    const facts = (await h.admin.query(`select i.consultation c, count(distinct i.id)::int inv, sum(a.amount - a.vat_portion)::bigint net
        from invoices i join commission_sale_attributions sa on sa.tenant_id = i.tenant_id and sa.invoice_id = i.id and sa.state = 'active' and sa.closing_bc_staff_id = $2
        join invoice_lines l on l.tenant_id = i.tenant_id and l.invoice_id = i.id
        join payment_allocations a on a.tenant_id = l.tenant_id and a.invoice_line_id = l.id and not a.is_simulated
       where i.tenant_id = $1 and i.state = 'issued' and not i.counter and 'closing_bc' = any (commission_item_scopes(l.tenant_id, l.catalog_version_id))
       group by i.consultation order by i.consultation`, [w.t.tenantId, bc1.staffId])).rows.map((r) => [r.c, r.inv, Number(r.net)]);
    expect(facts).toEqual([[false, 4, 5_455_000], [true, 1, 150_000]]);
    expect((await h.admin.query(`select state, amount::bigint a, vat_reversed::bigint v from refunds where id = $1`, [rf.refund_id])).rows.map((r) => [r.state, Number(r.a), Number(r.v)]))
      .toEqual([["paid", 333_000, 0]]);
    // targets for the captured WIB month (the database's month the facts were stamped in; both readers read it)
    for (const [bc, target] of [[bc1, F.targets[0].target], [bc3, F.targets[1].target]] as const)
      await as(own, (db) => setStaffTarget(db, key(), bc.staffId, period, { closingValueTarget: target }));
    const [e1, e3] = K19();
    const list = await as(own, (db) => listTargets(db, { period }));
    const row = (s: P) => list.rows.find((r) => r.staff_id === s.staffId)!;
    for (const [s, e] of [[bc1, e1], [bc3, e3]] as const)
      expect([row(s).closing_value_actual, row(s).target?.closing_value_target, row(s).attainment_bps]).toEqual([e.closing, e.target, e.bps]);
    const mine = await as(bc1, (db) => myTarget(db, period));
    expect([mine.closing_value_actual, mine.target?.closing_value_target, mine.attainment_bps]).toEqual([5_122_000, 6_000_000, 8_536]);
  });
});

// one harness for the whole file: the slice 2–4 block opens it, the slice 5 block reuses it; closed once, after both
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end(); await worker?.end(); await owner?.end(); await h?.close();
});
