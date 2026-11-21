// The boundary between the `recon_report` reader (drizzle/0129_recon_report.sql; owner, finance, auditor) and the pure engine: validate and map the reader's JSON (snake_case, bigint as number or string) into ReconInput. Anything malformed is refused
// with an error, never read as an empty or clean report: a missing part, an unknown metric, a non-integer or unsafe amount, a bad day.
import type pg from "pg";
import { call } from "../ledger/ledger";
import { METRICS, type Metric, reconcile, type ReconInput, type ReconReport, type Ref } from "./recon";

const fail = (what: string): never => {
  throw new Error(`recon_report: ${what}`);
};
const obj = (v: unknown, what: string): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(what);
const arr = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? v : fail(`${what} missing`));
const str = (v: unknown, what: string): string => (typeof v === "string" && v.length > 0 ? v : fail(what));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown, what: string): string => {
  const s = str(v, what);
  return DAY.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s ? s : fail(`${what} not a calendar day`);
};
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const period = (v: unknown, what: string) => (PERIOD.test(str(v, what)) ? (v as string) : fail(`${what} not a period`));
// bigint arrives as a JSON number or, from ::text, a string; both must be an exact safe integer
const rupiah = (v: unknown, what: string): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && (typeof v !== "string" || BigInt(v) === BigInt(n)) ? n : fail(`${what} not integer rupiah`);
};
const metric = (v: unknown): Metric => ((METRICS as readonly unknown[]).includes(v) ? (v as Metric) : fail(`unknown metric ${String(v)}`));
const ref = (v: unknown): Ref => {
  const o = obj(v, "ref");
  return { kind: str(o.kind, "ref.kind"), id: str(o.id, "ref.id"), label: str(o.label, "ref.label") };
};
const branch = (v: unknown) => (v === null ? null : str(v, "branch_id"));

export function toReconInput(raw: unknown): ReconInput {
  const r = obj(raw, "not an object");
  return {
    from: day(r.from, "from"), to: day(r.to, "to"),
    branches: arr(r.branches, "branches").map((b) => { const o = obj(b, "branch"); return { id: str(o.id, "branch.id"), name: str(o.name, "branch.name") }; }),
    facts: arr(r.facts, "facts").map((x) => {
      const o = obj(x, "fact");
      return { metric: metric(o.metric), ref: ref(o.ref), day: day(o.day, "fact.day"), branchId: str(o.branch_id, "fact.branch_id"), amount: rupiah(o.amount, "fact.amount") };
    }),
    postings: arr(r.postings, "postings").map((x) => {
      const o = obj(x, "posting");
      return { metric: metric(o.metric), ref: ref(o.ref), entryId: str(o.entry_id, "posting.entry_id"), businessDay: day(o.business_day, "posting.business_day"),
        period: period(o.period, "posting.period"), originalPeriod: period(o.original_period, "posting.original_period"),
        branchId: str(o.branch_id, "posting.branch_id"), amount: rupiah(o.amount, "posting.amount") };
    }),
    pending: arr(r.pending, "pending").map((x) => {
      const o = obj(x, "pending");
      return { eventId: str(o.event_id, "pending.event_id"), event: str(o.event, "pending.event"), ref: ref(o.ref) };
    }),
    clearing: arr(r.clearing, "clearing").map((x) => {
      const o = obj(x, "clearing");
      return { day: day(o.day, "clearing.day"), branchId: str(o.branch_id, "clearing.branch_id"), amount: rupiah(o.amount, "clearing.amount") };
    }),
    clearingNet: arr(r.clearing_net, "clearing_net").map((x) => {
      const o = obj(x, "clearing_net");
      return { day: day(o.day, "clearing_net.day"), amount: rupiah(o.amount, "clearing_net.amount") };
    }),
    handover: arr(r.handover, "handover").map((x) => {
      const o = obj(x, "handover");
      return { branchId: str(o.branch_id, "handover.branch_id"), fractional: rupiah(o.fractional, "handover.fractional"), unlinked: rupiah(o.unlinked, "handover.unlinked") };
    }),
    unavailable: arr(r.unavailable, "unavailable").map((x) => {
      const o = obj(x, "unavailable");
      return { metric: metric(o.metric), branchId: branch(o.branch_id), reason: str(o.reason, "unavailable.reason") };
    }),
  };
}

// Read the reconciliation for a period (and optionally one branch) through the definer, validate it at this boundary, then reconcile.
// Refusals keep their code (ERR_FORBIDDEN for other roles, ERR_NOT_FOUND for another tenant's branch, ERR_INVALID_INPUT for a bad period).
export async function readRecon(db: pg.ClientBase, o: { from: string; to: string; branchId?: string | null }): Promise<ReconReport> {
  const r = await call(() => db.query<{ r: unknown }>(`select recon_report($1::date, $2::date, $3) as r`, [o.from, o.to, o.branchId ?? null]));
  return reconcile(toReconInput(r.rows[0].r));
}
