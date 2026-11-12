// Invoice foundation (DATA-27, PR-24, PR-42; T-071). The minimal writers: a draft at a branch and its issue with
// lines frozen at one instant (the branch price, the tax category and basis, the PKP state and the VAT split of the
// line total after discount). Payment, numbering, receipts and voids arrive with the Kasir (T-072). Every call runs
// inside withTenantContext; the database decides authority (owner, manager, FO/cashier, finance; a branch role at its
// active branch) and refuses a PKP taxable line while the VAT gate is closed (ERR_GATE_CLOSED).
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import type { TaxCategory } from "../../tax/policy";
import { call } from "../../tax/tax";
import { assertProductionGoLive } from "../../vendor/profile/profile";

export class InvoiceError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T), InvoiceError);
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export async function openInvoice(db: pg.ClientBase, key: string, branchId: string | null, o: { patientId?: string; visitId?: string } = {}) {
  const p: Record<string, Json> = {};
  if (o.patientId) p.patient_id = o.patientId;
  if (o.visitId) p.visit_id = o.visitId;
  const out = await command<string>(db, "invoice_open", key, { branch_id: branchId, invoice: p }, `select invoice_open($1, $2, $3::jsonb) as r`, [key, branchId, JSON.stringify(p)]);
  return { invoiceId: out.result, replayed: out.replayed };
}

export type LineInput = { itemId: string; quantity: number; discount?: number };
export async function issueInvoice(db: pg.ClientBase, key: string, invoiceId: string, lines: LineInput[]) {
  const p = { lines: lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, ...(l.discount !== undefined ? { discount: l.discount } : {}) })) };
  const out = await command<{ invoice_id: string; issued_at: string; is_pkp_at_issue: boolean }>(db, "invoice_issue", key, { invoice_id: invoiceId, issue: p },
    `select invoice_issue($1, $2, $3::jsonb) as r`, [key, invoiceId, JSON.stringify(p)]);
  return { ...out.result, replayed: out.replayed };
}

export type InvoiceLine = {
  id: string; item_id: string; catalog_version_id: string; quantity: number; unit_price: number; discount: number; line_total: number;
  tax_category: TaxCategory; tax_basis: string; vat_base: number; vat_amount: number;
};
export type Invoice = { id: string; branch_id: string; state: "draft" | "issued" | "void"; issued_at: string | null; is_pkp_at_issue: boolean | null; lines: InvoiceLine[] };
export const getInvoice = (db: pg.ClientBase, id: string) => call(async () => (await db.query(`select invoice_get($1) as r`, [id])).rows[0].r as Invoice, InvoiceError);
