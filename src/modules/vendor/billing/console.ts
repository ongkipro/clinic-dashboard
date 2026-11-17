// Konsol Vendor › Tagihan Server (UX-43; T-103 increment 2; Panel 2 option A). The console names its caller by the vendor session token; the
// database runs the vendor guard (role, IP allowlist, 10-minute step-up), logs every authenticated outcome and re-reads the caller's authority
// after its last wait. Requests are server_fee_change / invoice_waiver only; deciding never applies — the executor worker does. The support
// note is evidence only: it never changes an attempt, the outstanding or whether a new attempt is allowed (not D2).
import type pg from "pg";
import { withAuthorityRecheck } from "../authority";
import { call, type ConsoleCall, type Result } from "../tenants/tenants";

export type BillingGates = { settlement_confirmed: boolean; fee_bearer: "tenant" | "vendor" | null; tax_treatment_set: boolean; vendor_tax_status_set: boolean };
export type BillingTenantRow = { id: string; name: string | null; state: string; issued: number; outstanding: number; reviews: number; pending_requests: number };
export type BillingList = { role: string; gates: BillingGates; tenants: BillingTenantRow[] };
export type ConsoleAttempt = { id: string; reff_id: string; channel: string; amount: number; state: string; rc: string | null; closed_by: string | null;
  expires_at: string; advice_count: number; observations: { at: string; interpreted: string; rc: string | null; status: string | null }[];
  notes: { at: string; evidence_ref: string; reason: string }[] };
export type ConsoleInvoice = { id: string; number: string; kind: "first" | "monthly"; period: string; service_from: string; service_to: string; issue_date: string;
  due_date: string; fee_amount: number; fee_source: string; proration: { days: number; days_in_month: number }; amount: number; vat: number; total: number;
  state: string; outstanding: number; attempts: ConsoleAttempt[]; reminders: { kind: "due" | "plus7" | "plus14"; sent_at: string }[] };
export type BillingRequest = { id: string; kind: "server_fee_change" | "invoice_waiver"; payload: Record<string, unknown>; reason: string; state: string;
  requested_by: string | null; requested_at: string; decided_by: string | null; decided_at: string | null; consumed: boolean; mine: boolean };
export type BillingDetail = { role: string; tenant: { id: string; name: string | null; state: string };
  fee_versions: { amount: number; effective_month: string; reason: string; created_at: string }[]; invoices: ConsoleInvoice[];
  credits: { kind: string; amount: number; remaining: number; reason: string; created_at: string }[];
  reviews: { kind: string; subject_id: string | null; period: string | null; created_at: string }[]; requests: BillingRequest[] };

export const billingList = (db: pg.Pool, c: ConsoleCall) =>
  call<BillingList>(db, `select vendor_console_billing($1, $2, $3) as r`, [c.token, c.ip, null], { tenant: null });
export const billingDetail = (db: pg.Pool, c: ConsoleCall, tenantId: string | null) =>
  call<BillingDetail>(db, `select vendor_console_billing($1, $2, $3) as r`, [c.token, c.ip, tenantId], { tenant: tenantId });

export type BillingRequestInput =
  | { kind: "server_fee_change"; amountRupiah: number; effectiveMonth: string }
  | { kind: "invoice_waiver"; invoiceId: string; amountRupiah: number };
export function requestBilling(db: pg.Pool, c: ConsoleCall, tenantId: string | null, p: BillingRequestInput, reason: string) {
  const payload = p.kind === "server_fee_change" ? { amount_rupiah: p.amountRupiah, effective_month: p.effectiveMonth } : { invoice_id: p.invoiceId, amount_rupiah: p.amountRupiah };
  return call<{ id: string }>(db, `select vendor_console_billing_request($1, $2, $3, $4, $5::jsonb, $6) as r`,
    [c.token, c.ip, tenantId, p.kind, JSON.stringify(payload), reason], { tenant: tenantId });
}
export const decideBilling = (db: pg.Pool, c: ConsoleCall, requestId: string | null, approve: boolean, reason: string) =>
  call<{ state: "approved" | "rejected" }>(db, `select vendor_console_billing_decide($1, $2, $3, $4, $5) as r`, [c.token, c.ip, requestId, approve, reason], { object: requestId });
export const cancelBilling = (db: pg.Pool, c: ConsoleCall, requestId: string | null) =>
  call<object>(db, `select vendor_console_billing_cancel($1, $2, $3) as r`, [c.token, c.ip, requestId], { object: requestId });

// Terbitkan Tagihan (UX-43; Panel 2 option b): the BILL-31 issuer for one tenant on today's date; reports issued / held by the tax gate /
// nothing due — never a success when nothing was issued.
export const issueBilling = (db: pg.Pool, c: ConsoleCall, tenantId: string | null) =>
  call<{ issued: number; held: number }>(db, `select vendor_console_billing_issue($1, $2, $3) as r`, [c.token, c.ip, tenantId], { tenant: tenantId });

// The support note (a2-2 N). Not a vendor_console_* name, so the authority re-check refusal is mapped here explicitly.
export async function noteAttempt(db: pg.Pool, c: ConsoleCall, attemptId: string | null, evidenceRef: string, reason: string): Promise<Result<object>> {
  return withAuthorityRecheck(db, c, "vendor_billing_attempt_note", { object: attemptId }, async () => {
    const r = (await db.query<{ r: { ok: boolean; code?: string; reason?: string } }>(`select vendor_billing_attempt_note($1, $2, $3, $4, $5) as r`,
      [c.token, c.ip, attemptId, evidenceRef, reason])).rows[0].r;
    return r.ok ? ({ ok: true, data: r } as const) : ({ ok: false, code: r.code ?? "ERR_FORBIDDEN", reason: r.reason } as const);
  });
}
