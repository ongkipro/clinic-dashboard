// K20–K27 from their SQL readers (report_k20 … report_k27; T-116 slice 4, migration pending a slot). Each reader returns FACTS shaped for
// the pure calculator of its KPI (calculators.ts), which stays the single definition: this module decodes the facts at the boundary
// (refusing a malformed payload, a non-integer rupiah, a bad day or instant) and hands them to the calculator. Units never change; what
// cannot be vouched for is unavailable with a reason, never 0 / Rp0.
import type pg from "pg";
import { call } from "../../accounting/subledgers/subledgers";
import {
  type CashRefundFact, type DispensingFact, type ExamFact, type Invoice, k20, k21, k22, k23, k24, k25, k26, k27, type PaymentFact, type Period,
  type PromoUsageFact, type RequestFact, type SaleReduction, type ShiftFact, type SurveyFact, type VisitFact,
} from "./calculators";

export class ReaderShapeError extends Error {}
const fail = (what: string): never => { throw new ReaderShapeError(`report reader: ${what}`); };
const obj = (v: unknown, what: string) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(what));
const arr = (v: unknown, what: string) => (Array.isArray(v) ? v : fail(`${what} missing`));
const str = (v: unknown, what: string) => (typeof v === "string" && v.length > 0 ? v : fail(what));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown, what: string) => {
  const s = str(v, what);
  return DAY.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s ? s : fail(`${what} not a calendar day`);
};
const optDay = (v: unknown, what: string) => (v === null ? null : day(v, what));
const instant = (v: unknown, what: string) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : fail(`${what} not an instant`));
const optInstant = (v: unknown, what: string) => (v === null ? null : instant(v, what));
// bigint arrives as a JSON number or a digit string; both must be an exact safe integer
const int = (v: unknown, what: string) => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && (typeof v !== "string" || BigInt(v) === BigInt(n)) ? n : fail(`${what} not an integer`);
};
const oneOf = <T extends string>(v: unknown, of: readonly T[], what: string): T => ((of as readonly unknown[]).includes(v) ? (v as T) : fail(`${what} unknown`));
const optStr = (v: unknown, what: string) => (v === null ? null : str(v, what));

// The reader's sale value at issue is already the K3 basis (line_total − VAT summed over the invoice; void → 0), so one "sale" line
// carries it into calculators.saleValue unchanged.
const invoiceOf = (x: unknown, withShift: boolean): Invoice => {
  const o = obj(x, "invoice");
  return { id: str(o.id, "invoice.id"), branch: str(o.branch_id, "invoice.branch_id"), patient: "", day: day(o.day, "invoice.day"),
    state: oneOf(o.state, ["issued", "void"] as const, "invoice.state"), shift: withShift ? optStr(o.shift_id, "invoice.shift_id") : null,
    lines: [{ kind: "service", value: int(o.sale_value, "invoice.sale_value") }] };
};
const reductionOf = (x: unknown): SaleReduction => {
  const o = obj(x, "reduction");
  return { invoice: str(o.invoice_id, "reduction.invoice_id"), branch: str(o.branch_id, "reduction.branch_id"), patient: "", day: day(o.day, "reduction.day"),
    amount: int(o.amount, "reduction.amount"), why: oneOf(o.why, ["refund", "cancelled_unpaid_package"] as const, "reduction.why") };
};

export const decode = {
  k20(raw: unknown) {
    const r = obj(raw, "k20");
    return { period: { from: day(r.from, "from"), to: day(r.to, "to") } as Period, invoices: arr(r.invoices, "invoices").map((x) => invoiceOf(x, false)),
      reductions: arr(r.reductions, "reductions").map(reductionOf) };
  },
  k21(raw: unknown) {
    const r = obj(raw, "k21");
    const visits: VisitFact[] = arr(r.visits, "visits").map((x) => { const o = obj(x, "visit"); return { patient: str(o.patient, "visit.patient"), branch: str(o.branch_id, "visit.branch_id"), day: day(o.day, "visit.day") }; });
    return { asOf: day(r.as_of, "as_of"), dormantDays: int(r.dormant_days, "dormant_days"), visits };
  },
  k22(raw: unknown) {
    const r = obj(raw, "k22");
    return arr(r.rows, "rows").map((x) => {
      const o = obj(x, "row");
      return { patient: str(o.patient, "row.patient"), mrn: str(o.mrn, "row.mrn"), name: optStr(o.name, "row.name"), ltv: int(o.ltv, "row.ltv"),
        byBranch: arr(o.by_branch, "row.by_branch").map((b) => { const q = obj(b, "by_branch"); return { branch: str(q.branch_id, "by_branch.branch_id"), value: int(q.value, "by_branch.value") }; }) };
    });
  },
  k23(raw: unknown) {
    const r = obj(raw, "k23");
    const shifts: ShiftFact[] = arr(r.shifts, "shifts").map((x) => { const o = obj(x, "shift"); return { id: str(o.id, "shift.id"), branch: str(o.branch_id, "shift.branch_id"), day: day(o.day, "shift.day") }; });
    const payments: PaymentFact[] = arr(r.payments, "payments").map((x) => {
      const o = obj(x, "payment");
      return { branch: str(o.branch_id, "payment.branch_id"), day: day(o.day, "payment.day"), shift: optStr(o.shift_id, "payment.shift_id"),
        amount: int(o.amount, "payment.amount"), method: str(o.method, "payment.method") as PaymentFact["method"],
        simulated: typeof o.simulated === "boolean" ? o.simulated : fail("payment.simulated") };
    });
    const refunds: CashRefundFact[] = arr(r.cash_refunds, "cash_refunds").map((x) => {
      const o = obj(x, "cash_refund");
      return { branch: str(o.branch_id, "cash_refund.branch_id"), day: day(o.day, "cash_refund.day"), shift: optStr(o.shift_id, "cash_refund.shift_id"), amount: int(o.amount, "cash_refund.amount") };
    });
    return { period: { from: day(r.from, "from"), to: day(r.to, "to") } as Period, shifts, invoices: arr(r.invoices, "invoices").map((x) => invoiceOf(x, true)), payments, refunds };
  },
  k24(raw: unknown) {
    const r = obj(raw, "k24");
    const ds: DispensingFact[] = arr(r.dispensings, "dispensings").map((x) => {
      const o = obj(x, "dispensing");
      return { branch: str(o.branch_id, "dispensing.branch_id"), state: oneOf(o.state, ["queued", "prepared", "handed", "cancelled"] as const, "dispensing.state"),
        queuedAt: instant(o.queued_at, "dispensing.queued_at"), handedAt: optInstant(o.handed_at, "dispensing.handed_at"), handedDay: optDay(o.handed_day, "dispensing.handed_day") };
    });
    return { period: { from: day(r.from, "from"), to: day(r.to, "to") } as Period, ds };
  },
  k25(raw: unknown) {
    const r = obj(raw, "k25");
    const labels = new Map<string, string>();
    const us: PromoUsageFact[] = arr(r.usages, "usages").map((x) => {
      const o = obj(x, "usage");
      const version = str(o.version, "usage.version");
      labels.set(version, `${str(o.code, "usage.code")} v${int(o.version_no, "usage.version_no")}`);
      return { promo: str(o.promo, "usage.promo"), version, branch: str(o.branch_id, "usage.branch_id"), state: oneOf(o.state, ["reserved", "consumed", "released"] as const, "usage.state"),
        day: optDay(o.day, "usage.day"), discount: int(o.discount, "usage.discount"), lineValue: int(o.line_value, "usage.line_value"), refundedInPeriod: int(o.refunded_in_period, "usage.refunded_in_period") };
    });
    return { period: { from: day(r.from, "from"), to: day(r.to, "to") } as Period, us, labels };
  },
  k26(raw: unknown) {
    const r = obj(raw, "k26");
    const ss: SurveyFact[] = arr(r.surveys, "surveys").map((x) => { const o = obj(x, "survey"); return { branch: str(o.branch_id, "survey.branch_id"), day: day(o.day, "survey.day"), score: int(o.score, "survey.score") }; });
    return { period: { from: day(r.from, "from"), to: day(r.to, "to") } as Period, ss };
  },
  k27(raw: unknown) {
    const r = obj(raw, "k27");
    const exams: ExamFact[] = arr(r.examinations, "examinations").map((x) => {
      const o = obj(x, "examination");
      return { doctor: str(o.doctor, "examination.doctor"), branch: str(o.branch_id, "examination.branch_id"), state: oneOf(o.state, ["draft", "signed"] as const, "examination.state"),
        createdAt: instant(o.created_at, "examination.created_at"), signedAt: optInstant(o.signed_at, "examination.signed_at"),
        signedDay: optDay(o.signed_day, "examination.signed_day"), checkedInAt: instant(o.checked_in_at, "examination.checked_in_at") };
    });
    const requests: RequestFact[] = arr(r.requests, "requests").map((x) => {
      const o = obj(x, "request");
      return { doctor: optStr(o.doctor, "request.doctor"), branch: str(o.branch_id, "request.branch_id"),
        state: oneOf(o.state, ["pending", "approved", "declined", "cancelled"] as const, "request.state"), decidedDay: optDay(o.decided_day, "request.decided_day") };
    });
    const names = obj(r.doctors, "doctors");
    return { period: { from: day(r.from, "from"), to: day(r.to, "to") } as Period, asOf: instant(r.as_of, "as_of"), exams, requests,
      names: new Map(Object.entries(names).map(([k, v]) => [k, str(v, "doctor name")])) };
  },
};

// The reader calls (the database decides role, tenant and branch scope; ERR_* are kept as CommandErrors).
type Q = { from: string; to: string; branchId?: string | null };
const one = async (db: pg.ClientBase, sql: string, args: unknown[]) => (await call(async () => (await db.query<{ r: unknown }>(sql, args)).rows[0].r));
export const read = {
  k20: async (db: pg.ClientBase, q: Q) => { const d = decode.k20(await one(db, `select report_k20($1::date, $2::date, $3) as r`, [q.from, q.to, q.branchId ?? null])); return k20(d.invoices, d.reductions, d.period); },
  k21: async (db: pg.ClientBase, q: { asOf: string; branchId?: string | null }) => { const d = decode.k21(await one(db, `select report_k21($1::date, $2) as r`, [q.asOf, q.branchId ?? null])); return k21(d.visits, d.asOf, d.dormantDays); },
  k22: async (db: pg.ClientBase, q: { asOf: string; branchId?: string | null; limit?: number }) => decode.k22(await one(db, `select report_k22($1::date, $2, $3) as r`, [q.asOf, q.branchId ?? null, q.limit ?? 10])),
  k23: async (db: pg.ClientBase, q: Q) => { const d = decode.k23(await one(db, `select report_k23($1::date, $2::date, $3) as r`, [q.from, q.to, q.branchId ?? null])); return k23(d.shifts, d.invoices, d.payments, d.refunds, d.period); },
  k24: async (db: pg.ClientBase, q: Q) => { const d = decode.k24(await one(db, `select report_k24($1::date, $2::date, $3) as r`, [q.from, q.to, q.branchId ?? null])); return k24(d.ds, d.period); },
  k25: async (db: pg.ClientBase, q: Q) => { const d = decode.k25(await one(db, `select report_k25($1::date, $2::date, $3) as r`, [q.from, q.to, q.branchId ?? null])); return { rows: k25(d.us, d.period), labels: d.labels }; },
  k26: async (db: pg.ClientBase, q: Q) => { const d = decode.k26(await one(db, `select report_k26($1::date, $2::date, $3) as r`, [q.from, q.to, q.branchId ?? null])); return k26(d.ss, d.period); },
  k27: async (db: pg.ClientBase, q: Q) => { const d = decode.k27(await one(db, `select report_k27($1::date, $2::date, $3) as r`, [q.from, q.to, q.branchId ?? null])); return { rows: k27(d.exams, d.requests, d.period, d.asOf), names: d.names }; },
};
