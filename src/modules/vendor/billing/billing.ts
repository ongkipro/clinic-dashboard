// Vendor server-fee billing (PR-61, BILL-20, BILL-31–BILL-33, TD-42; T-103 increment 1, migration 0119, DEC-114). The database decides every
// money rule; this module runs the provider calls between its steps:
//   Bayar = bayar_begin (tenant transaction, committed: the reff_id exists before the request; a one-time finish token) → createPayment
//           (outside any transaction) → bayar_finish (an unbound connection, the token, fenced on state and generation).
//   Advice = advice_due (executor) → advice (port, per attempt) → advice_record (executor): success envelope first, then only a CONFIRMED
//           AutoLaris rule settles, expires or fails (Q-13 fail-closed); a settlement is allocated up to the payable, the rest is a credit.
// Fail-closed gates (Panel 2, plan addendum a1): Bayar is refused while the channel-fee bearer is undecided (Q-16); no invoice is issued while
// the VAT treatment or the vendor's tax status is unknown (BILL-33); nothing unlocks a new attempt except Advice under a confirmed rule.
import type pg from "pg";
import { withTenantContext, type TenantContext } from "../../../db/rls/context";
import { CommandError, type ErrorCode } from "../../../lib/command";
import { type AutolarisPort, type Channel, envelopeOk } from "./port";

export class BillingError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
// The refusal reason: "ERR_X: (reason)" at the end (vendor_request_consume's form), else a message that is one snake_case token; else none.
const CODE = /^(ERR_[A-Z_]+):?\s*(.*)$/;
const reasonOf = (rest: string) => /\((\w+)\)$/.exec(rest)?.[1] ?? (/^[a-z][a-z_]*$/.test(rest) ? rest : undefined);
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT"]);
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new BillingError(m[1] as ErrorCode, reasonOf(m[2]));
    throw e;
  }
}
const one = async <T>(db: pg.Pool | pg.ClientBase, sql: string, args: unknown[]): Promise<T> =>
  call(async () => Object.values((await db.query(sql, args)).rows[0])[0] as T);

// WIB timestamp for the provider's `expired` field (YYYYMMDDHHMMSS; the provider has not published its timezone — Asia/Jakarta is assumed).
export function wib(d: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

// The payment channels the vendor account offers now (runtime, TD-42), minus COD; an error envelope offers nothing.
export async function channels(port: AutolarisPort): Promise<Channel[]> {
  const x = await port.listPayment();
  if (!envelopeOk(x) || !Array.isArray(x.body?.data)) return [];
  return (x.body!.data as Channel[]).filter((c) => typeof c?.channel_code === "string" && /^[A-Z0-9_]{2,20}$/.test(c.channel_code) && c.channel_code !== "COD");
}

export type BayarResult = { attemptId: string; reffId: string; state: "pending" | "failed" | "unknown" | "stale" | "creating" | "refused"; replayed: boolean };
export type Payer = { id: string; name: string; phone: string; email: string };

// Bayar (UX-49; owner / finance): begin (committed; returns the one-time finish token) → create_payment → finish (unbound, token-fenced).
// A replayed key returns the existing attempt without calling the provider again.
// `unbound`: a pool on which no tenant context is ever set (the finish refuses a bound connection, a2-1) — the app's worker pool in the server.
export async function bayar(app: pg.Pool, unbound: pg.Pool, ctx: TenantContext, port: AutolarisPort, o: {
  key: string; invoiceId: string; channel: string; payer: Payer; now?: Date; service?: string;
}): Promise<BayarResult> {
  const now = o.now ?? new Date();
  const offered = (await channels(port)).map((c) => c.channel_code);
  const b = await withTenantContext(app, ctx, (db) => one<{ attempt_id: string; reff_id: string; amount: number; channel: string; expires_at: string;
    generation: number; state: string; replayed: boolean; finish_token?: string }>(db, `select vendor_billing_bayar_begin($1, $2, $3, $4, $5)`, [o.key, o.invoiceId, o.channel, offered, now]));
  // a replay never receives the one-time finish token (a2-1): it makes no provider call and cannot finish
  if (b.replayed || !b.finish_token) return { attemptId: b.attempt_id, reffId: b.reff_id, state: b.state as BayarResult["state"], replayed: true };
  const x = await port.createPayment({
    reff_id: b.reff_id, channel_code: b.channel, customer_id: o.payer.id, customer_name: o.payer.name, customer_phone: o.payer.phone,
    customer_email: o.payer.email, expired: wib(new Date(b.expires_at)), amount: String(b.amount), callback_url: "",
  });
  return { attemptId: b.attempt_id, reffId: b.reff_id, replayed: false,
    state: await finish(unbound, b.attempt_id, b.finish_token, b.generation, x, o.service ?? "billing.bayar", now) as BayarResult["state"] };
}

// The provider's create answer → the fenced finish. A 2xx with rc ≠ 00 → failed (no transaction id stored); anything indeterminate → unknown.
export async function finish(unbound: pg.Pool, attemptId: string, finishToken: string, generation: number, x: Awaited<ReturnType<AutolarisPort["createPayment"]>>,
  service: string, now = new Date()) {
  const d = (x.body?.data ?? {}) as Record<string, unknown>;
  // Only a 2xx answer with a provider rc other than "00" is a rejection (failed, a new attempt allowed). No answer, a non-2xx status (5xx,
  // 4xx — a gateway may have created the transaction), or a 2xx without a usable rc is indeterminate: unknown, never re-created (BILL-32).
  const rejected = x.http !== null && x.http >= 200 && x.http < 300 && typeof x.body?.rc === "string" && /^[0-9A-Za-z]{1,8}$/.test(x.body.rc) && x.body.rc !== "00";
  const outcome = envelopeOk(x) ? "ok" : rejected ? "rc" : "transport";
  const instruction = outcome === "ok"
    ? Object.fromEntries((["virtual_account", "qr", "payment_code", "url"] as const).filter((k) => typeof d[k] === "string" && (d[k] as string) !== "").map((k) => [k, d[k]]))
    : null;
  const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
  const p = outcome === "ok"
    ? { trx_id: String(d.trx_id ?? ""), admin: int(d.admin), total: int(d.total), instruction, ket: String(x.body?.ket ?? "") }
    : { rc: String(x.body?.rc ?? ""), ket: String(x.body?.ket ?? ""), raw: x.body ? { rc: x.body.rc, ket: x.body.ket } : {} };
  return one<string>(unbound, `select vendor_billing_bayar_finish($1, $2, $3, $4, $5::jsonb, $6, $7)`, [attemptId, finishToken, generation, outcome, JSON.stringify(p), now, service]);
}

// The Advice worker: every due attempt (pending / unknown / expired with a provider id, inside expires_at + 24 h), one provider read each;
// one attempt failing never stops the others.
export type AdviceResult = { read: number; settled: number; expired: number; failed: number; errors: number };
export async function runAdvice(executor: pg.Pool, port: AutolarisPort, o: { now?: Date; limit?: number; service?: string } = {}): Promise<AdviceResult> {
  const now = o.now ?? new Date();
  const service = o.service ?? "billing.advice";
  const due = (await executor.query(`select * from vendor_billing_advice_due($1, $2)`, [now, o.limit ?? 50])).rows as { attempt_id: string; trx_id: string }[];
  const r: AdviceResult = { read: 0, settled: 0, expired: 0, failed: 0, errors: 0 };
  for (const d of due) {
    try {
      const x = await port.advice(d.trx_id);
      const out = await one<string>(executor, `select vendor_billing_advice_record($1, $2, $3::jsonb, $4, $5)`, [d.attempt_id, x.http, JSON.stringify(x.body ?? {}), now, service]);
      r.read++;
      if (out === "settled") r.settled++;
      if (out === "expired") r.expired++;
      if (out === "failed") r.failed++;
    } catch (e) {
      r.errors++;
      console.error("billing: advice failed", { attempt: d.attempt_id, code: (e as { code?: string }).code });
    }
  }
  return r;
}

// The scheduler's other steps (executor login, unbound): issue, recover abandoned `creating` attempts, reminders.
export const issue = (executor: pg.Pool, now = new Date(), service = "billing.issue") => one<number>(executor, `select vendor_billing_issue($1, $2)`, [now, service]);
export const recover = (executor: pg.Pool, now = new Date(), service = "billing.recover") => one<number>(executor, `select vendor_billing_recover($1, $2)`, [now, service]);
export const reminders = (executor: pg.Pool, now = new Date(), service = "billing.reminders") => one<number>(executor, `select vendor_billing_reminders($1, $2)`, [now, service]);

// An approved server_fee_change / invoice_waiver applied by the executor (the request is consumed in the same call; a refusal rolls back).
export const applyFeeChange = (executor: pg.Pool, requestId: string, tenantId: string, service = "billing.fee") =>
  one<string>(executor, `select vendor_billing_apply_fee_change($1, $2, $3)`, [requestId, tenantId, service]);
export const applyWaiver = (executor: pg.Pool, requestId: string, tenantId: string, service = "billing.waiver") =>
  one<string>(executor, `select vendor_billing_apply_waiver($1, $2, $3)`, [requestId, tenantId, service]);

// Saya › Tagihan Server (UX-49) for the bound tenant.
export type TenantInvoice = {
  id: string; number: string; kind: "first" | "monthly"; period: string; service_from: string; service_to: string; issue_date: string; due_date: string;
  fee_amount: number; proration: { days: number; days_in_month: number; formula: string }; amount: number; vat: number; total: number;
  state: "issued" | "paid" | "waived" | "credited"; outstanding: number; credits: { kind: string; amount: number }[];
  attempts: { id: string; reff_id: string; channel: string; amount: number; state: string; expires_at: string; admin: number | null; total: number | null;
    instruction: { virtual_account?: string; qr?: string; payment_code?: string; url?: string } | null }[];
  payments: { settled_at: string; amount: number; reff_id: string; channel: string }[];
};
export type TenantView = { role: string; can_pay: boolean; payment_available: boolean; credit_balance: number; invoices: TenantInvoice[] };
export const tenantView = (db: pg.ClientBase) => one<TenantView>(db, `select vendor_billing_tenant_view()`, []);
