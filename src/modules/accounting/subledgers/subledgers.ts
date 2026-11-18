// Accounting step 1 (PR-25, A-01, A-14; T-104, migration 0121, DEC-115): sub-ledger roll-forwards, the sub-ledger / transaction CSV and
// the two finance-entered VAT facts (owner D-A1). The database decides who reads (owner, finance, auditor), who exports (owner, finance)
// and who records VAT facts (finance, PKP tenants only); every amount is integer rupiah.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";

export class SubledgerError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_NOT_AVAILABLE", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT"]);
export async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new SubledgerError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}

export const LEDGERS = [
  "cash_bank", "gateway_clearing", "paid_not_delivered", "receivables", "patient_balance", "package_liability", "inter_branch", "booking_dp",
  "commission_payable", "vat",
] as const;
export type Ledger = (typeof LEDGERS)[number];
export const TRANSACTION_SETS = ["payments", "invoice_lines", "commissions", "stock"] as const;
export type ExportKind = Ledger | (typeof TRANSACTION_SETS)[number];
export const EXPORT_KINDS: readonly ExportKind[] = [...LEDGERS, ...TRANSACTION_SETS];

// opening / closing are claimed only when complete (D-C1, Panel 2 R1); known_before_cutover is the sum of the dated movements otherwise.
export type LedgerRoll = {
  opening: number; closing: number; opening_complete: boolean; closing_complete: boolean; known_before_cutover: number | null;
  terms: Record<string, number>; by_dim: Record<string, number>; by_branch: Record<string, number>;
};
export type Check = {
  level: "stored_stock" | "object" | "identity"; expected?: number; mismatches?: number; checked?: number; incomplete?: number;
  stored_now?: number | null; stored_mismatches?: number | null; carry_forward_mismatches?: number;
  ran?: boolean; reason?: "branch_view" | "historical";
  mismatched?: { id: string; ledger: number; expected: number }[];
};
export type ReceiptsCheck = { level: "identity"; received: number; allocated: number; unallocated: number; mismatches: number; ledger_mismatch: boolean };
export type VatPeriod = { period: string; pkp: boolean; input_recorded: boolean; paid_recorded: boolean };
export type Rollforward = {
  role: string; from: string; to: string; branch_id: string | null; can_record_vat: boolean; can_export: boolean;
  branches: { id: string; name: string; code: string }[];
  ledgers: Record<Ledger, LedgerRoll>; checks: Record<Ledger, Check> & { receipts: ReceiptsCheck };
  vat: {
    pkp_ever: boolean; cutover_at: string | null; closing_complete: boolean; opening_complete: boolean; periods: VatPeriod[];
    input_credits: { id: string; period: string; amount: number; effective_on: string; evidence_ref: string; reason: string | null; recorded_at: string }[];
    payments: { id: string; period: string; amount: number; paid_on: string; ntpn: string; reason: string | null; recorded_at: string }[];
  };
  staff: Record<string, string>;
  aging: { d0_30: number; d31_60: number; d61_90: number; d90: number } | null;
};

// A real calendar date (YYYY-MM-DD) PostgreSQL accepts, checked before it casts it (Sol r1 P2-6: 2026-02-30 refused; Sol r2 #5: year 0000,
// valid in JavaScript, is not an AD date in PostgreSQL), never a server error.
export function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s.startsWith("0000")) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function period(from: string, to: string) {
  if (!isCalendarDate(from) || !isCalendarDate(to)) throw new SubledgerError("ERR_INVALID_INPUT", "period");
}
export const rollforward = (db: pg.ClientBase, o: { from: string; to: string; branchId?: string | null }) => {
  period(o.from, o.to);
  return call(async () => (await db.query(`select subledger_rollforward($1::date, $2::date, $3) as r`, [o.from, o.to, o.branchId ?? null])).rows[0].r as Rollforward);
};

// One CSV: a header row then data rows (all text). Opaque ids and document numbers only.
export async function exportRows(db: pg.ClientBase, o: { kind: ExportKind; from: string; to: string; branchId?: string | null; staffId?: string | null }) {
  period(o.from, o.to);
  return call(async () => (await db.query<Record<string, string>>(`select * from subledger_export($1, $2::date, $3::date, $4, $5)`,
    [o.kind, o.from, o.to, o.branchId ?? null, o.staffId ?? null])).rows.map((r) => [r.c1, r.c2, r.c3, r.c4, r.c5, r.c6, r.c7, r.c8, r.c9]));
}
// CSV cells (Sol r1 P1-7): a cell a spreadsheet could evaluate — one starting with = + - @, or with a tab, CR, LF or other control character
// or whitespace before such a marker — gets a leading apostrophe; an integer amount (optionally negative) stays a plain number. Cells with a
// quote, comma or line break are quoted.
const DANGEROUS = /^[\s\u0000-\u001f\u007f]*[=+\-@]|^[\u0000-\u001f\u007f]/;
export const csvCell = (v: string | null) => {
  const s = v ?? "";
  const safe = DANGEROUS.test(s) && !/^-?\d+$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const toCsv = (rows: (string | null)[][]) => {
  const width = Math.max(...rows.map((r) => r.findLastIndex((c) => c !== "" && c !== null) + 1), 1);
  return rows.map((r) => r.slice(0, width).map(csvCell).join(",")).join("\r\n") + "\r\n";
};

export type VatFact = { taxPeriod: string; amount: number; date: string; reference: string; reason?: string | null };
async function record(db: pg.ClientBase, fn: "vat_input_credit_record" | "vat_payment_record", key: string, f: VatFact) {
  if (!isCalendarDate(f.date)) throw new SubledgerError("ERR_INVALID_INPUT", "date");
  await assertProductionGoLive(db);
  const input = fn === "vat_input_credit_record";
  const p: Record<string, Json> = { tax_period: f.taxPeriod, amount: f.amount, [input ? "effective_on" : "paid_on"]: f.date, [input ? "evidence_ref" : "ntpn"]: f.reference };
  if (f.reason) p.reason = f.reason;
  const out = await call(() => runCommand<string>(db, { command: fn, key, body: p }, async (c) => (await c.query(`select ${fn}($1, $2::jsonb) as r`, [key, JSON.stringify(p)])).rows[0].r as string));
  if (!out.ok) throw out.error;
  return { id: out.result, replayed: out.replayed };
}
export const recordVatInputCredit = (db: pg.ClientBase, key: string, f: VatFact) => record(db, "vat_input_credit_record", key, f);
export const recordVatPayment = (db: pg.ClientBase, key: string, f: VatFact) => record(db, "vat_payment_record", key, f);
