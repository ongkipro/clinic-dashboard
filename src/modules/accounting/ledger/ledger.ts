// Accounting step 2 (PR-26, A-01, A-02; T-105, migration 0123): the general ledger readers and the finance commands. Statements are generic
// by account class and NOT SAK-labelled (Panel 2 G2); every view carries the books' status — a preview until an activation decision exists
// (open gates G-ACT / G-RETRO; none can be made in T-105); journal export is refused unless the posting map version is signed AND the books
// are activated (fail-closed). Amounts are integer rupiah.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { csvCell } from "../subledgers/subledgers";

export class LedgerError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_PERIOD_LOCKED", "ERR_GATE_CLOSED", "ERR_IDEMPOTENCY_CONFLICT"]);
export async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new LedgerError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}

export const ACCOUNT_CLASSES = ["asset", "liability", "equity", "revenue", "expense"] as const;
export type AccountClass = (typeof ACCOUNT_CLASSES)[number];
export type LedgerStatus = { state: "preview" | "active"; map_version: string; map_signed: boolean; activated: boolean; locked_periods: string[] };
export type TbRow = { key: string; label: string; class: AccountClass; opening: number; debit: number; credit: number; closing: number };
export type Report = {
  status: LedgerStatus; from: string; to: string; branch_id: string | null; trial_balance: TbRow[];
  income: { key: string; label: string; class: AccountClass; amount: number }[]; net_income: number;
  balance_sheet: { key: string; label: string; class: AccountClass; amount: number }[]; retained: number;
  cash_flow: Partial<Record<AccountClass, number>>; balanced: boolean;
};
export type JournalLine = { account: string; label: string; branch_id: string | null; debit: number; credit: number };
export type Entry = {
  id: string; kind: "auto" | "manual" | "reversal"; event: string; business_date: string; period: string; original_period: string;
  map_version: string | null; memo: string | null; posted_at: string; reverses_entry_id: string | null; lines: JournalLine[];
};
export type Journal = { status: LedgerStatus; entries: Entry[]; accounts: { key: string; label: string; class: AccountClass }[] };

const num = (v: unknown) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError("unsafe integer money amount");
  return n;
};
const normalizeReport = (r: Report): Report => ({
  ...r,
  trial_balance: r.trial_balance.map((x) => ({ ...x, opening: num(x.opening), debit: num(x.debit), credit: num(x.credit), closing: num(x.closing) })),
  income: r.income.map((x) => ({ ...x, amount: num(x.amount) })),
  balance_sheet: r.balance_sheet.map((x) => ({ ...x, amount: num(x.amount) })),
  net_income: num(r.net_income), retained: num(r.retained),
  cash_flow: Object.fromEntries(Object.entries(r.cash_flow).map(([k, v]) => [k, num(v)])),
});

export const isCalendarDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s.startsWith("0000")) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export async function report(db: pg.ClientBase, o: { from: string; to: string; branchId?: string | null }): Promise<Report> {
  if (!isCalendarDate(o.from) || !isCalendarDate(o.to)) throw new LedgerError("ERR_INVALID_INPUT", "period");
  const r = await call(() => db.query<{ r: Report }>(`select ledger_report($1::date, $2::date, $3) as r`, [o.from, o.to, o.branchId ?? null]));
  return normalizeReport(r.rows[0].r);
}

// "Selisih penyerahan produk" (T-105 G-Q4 U1–U4, Panel 2 decision; drizzle/0124 ledger_handover_exceptions): handed visit selection
// products with no exact live invoice-line link, hand-over day in the period, link state as of now. Counts only; an exception, not a fix.
export type HandoverExceptions = { from: string; to: string; branch_id: string | null; as_of: string; fractional: number; unlinked: number };
export async function handoverExceptions(db: pg.ClientBase, o: { from: string; to: string; branchId?: string | null }): Promise<HandoverExceptions> {
  if (!isCalendarDate(o.from) || !isCalendarDate(o.to)) throw new LedgerError("ERR_INVALID_INPUT", "period");
  const r = await call(() => db.query<{ r: HandoverExceptions }>(`select ledger_handover_exceptions($1::date, $2::date, $3) as r`, [o.from, o.to, o.branchId ?? null]));
  const x = r.rows[0].r;
  return { ...x, fractional: Number(x.fractional), unlinked: Number(x.unlinked) };
}

export async function journal(db: pg.ClientBase, o: { from: string; to: string; branchId?: string | null; before?: string | null }): Promise<Journal> {
  if (!isCalendarDate(o.from) || !isCalendarDate(o.to)) throw new LedgerError("ERR_INVALID_INPUT", "period");
  const r = await call(() => db.query<{ r: Journal }>(`select ledger_journal($1::date, $2::date, $3, $4) as r`, [o.from, o.to, o.branchId ?? null, o.before ?? null]));
  const j = r.rows[0].r;
  return { ...j, entries: j.entries.map((e) => ({ ...e, lines: e.lines.map((l) => ({ ...l, debit: num(l.debit), credit: num(l.credit) })) })) };
}

export type ManualLine = { account: string; branchId?: string | null; debit?: number; credit?: number };
export async function postManual(db: pg.ClientBase, key: string, m: { date: string; memo: string; lines: ManualLine[] }) {
  if (!isCalendarDate(m.date)) throw new LedgerError("ERR_INVALID_INPUT", "date");
  const p: Record<string, Json> = {
    date: m.date, memo: m.memo,
    lines: m.lines.map((l): Json => ({ account: l.account, ...(l.branchId ? { branch_id: l.branchId } : {}), debit: l.debit ?? 0, credit: l.credit ?? 0 })),
  };
  const out = await call(() => runCommand<string>(db, { command: "ledger_manual_post", key, body: p },
    async (c) => (await c.query(`select ledger_manual_post($1, $2::jsonb) as r`, [key, JSON.stringify(p)])).rows[0].r as string));
  if (!out.ok) throw out.error;
  return { entryId: out.result, replayed: out.replayed };
}

export async function lockPeriod(db: pg.ClientBase, key: string, period: string) {
  const out = await call(() => runCommand<string>(db, { command: "ledger_period_lock", key, body: { period } },
    async (c) => (await c.query(`select ledger_period_lock($1, $2) as r`, [key, period])).rows[0].r as string));
  if (!out.ok) throw out.error;
  return { periodId: out.result, replayed: out.replayed };
}

// CSV journal export (11 :156: date, branch, account, debit, credit, reference): refused by the database unless signed AND activated. A
// refusal is returned, not thrown, so the caller's transaction commits the denied audit row with it.
export type ExportResult = { ok: true; csv: string } | { ok: false; refused: "posting_map_unsigned" | "ledger_not_activated" };
export async function exportJournal(db: pg.ClientBase, o: { from: string; to: string }): Promise<ExportResult> {
  if (!isCalendarDate(o.from) || !isCalendarDate(o.to)) throw new LedgerError("ERR_INVALID_INPUT", "period");
  type Row = { date: string; branch: string | null; account: string; debit: number; credit: number; reference: string };
  const r = await call(() => db.query<{ r: { refused?: "posting_map_unsigned" | "ledger_not_activated"; rows?: Row[] } }>(
    `select ledger_journal_export($1::date, $2::date) as r`, [o.from, o.to]));
  const out = r.rows[0].r;
  // the database refuses (and audits the refusal) unless the map version is signed AND the books are activated
  if (out.refused) return { ok: false, refused: out.refused };
  const rows = [["tanggal", "cabang", "akun", "debit", "kredit", "referensi"], ...(out.rows ?? []).map((x) => [x.date, x.branch, x.account, String(x.debit), String(x.credit), x.reference])];
  return { ok: true, csv: "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n" };
}
