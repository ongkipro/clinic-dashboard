// Suppliers and supplier returns (PR-75, BILL-30, DATA-54, DATA-61; T-066, DEC-076). Every call runs inside
// withTenantContext; the database decides authority (supplier master: purchasing, admin pusat, owner; receipts:
// pharmacist, purchasing; returns: purchasing, pharmacist, manager, admin pusat, owner). Commands go through runCommand
// with the caller's key (production needs the go-live gate first); database errors are mapped outside it. Results hold
// ids only; readers show money only to cost readers (owner, admin pusat, finance, purchasing, auditor, manager).
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import type { EXPECTATION_STATES, RETURN_REASONS } from "../schema";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT",
  "ERR_STOCK_UNFIT", "ERR_STOCK_INSUFFICIENT"]);

export class SupplierError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new SupplierError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}
const QTY = /^\d{1,10}(\.\d{1,4})?$/;
const qty = (q: string) => {
  if (!QTY.test(q)) throw new SupplierError("ERR_INVALID_INPUT", "quantity");
  return q;
};

export type ReturnReason = (typeof RETURN_REASONS)[number];
export type ExpectationState = (typeof EXPECTATION_STATES)[number];

export type SupplierInput = {
  name: string; npwp?: string | null; contactName?: string | null; phone?: string | null; email?: string | null; address?: string | null;
  paymentTermsDays?: number; active?: boolean;
};
export async function saveSupplier(db: pg.ClientBase, key: string, supplierId: string | null, s: SupplierInput) {
  const p: Record<string, Json> = { name: s.name };
  if (s.npwp != null) p.npwp = s.npwp;
  if (s.contactName != null) p.contact_name = s.contactName;
  if (s.phone != null) p.phone = s.phone;
  if (s.email != null) p.email = s.email;
  if (s.address != null) p.address = s.address;
  if (s.paymentTermsDays !== undefined) {
    if (!Number.isInteger(s.paymentTermsDays)) throw new SupplierError("ERR_INVALID_INPUT", "payment terms");
    p.payment_terms_days = s.paymentTermsDays;
  }
  if (s.active !== undefined) p.active = s.active;
  const out = await command<string>(db, "supplier_save", key, { supplier_id: supplierId, supplier: p }, `select supplier_save($1, $2::jsonb) as r`, [supplierId, JSON.stringify(p)]);
  return { supplierId: out.result, replayed: out.replayed };
}

export type ReceiveInput = { supplierId: string; itemId: string; batchNo: string; expiry: string; quantity: string; unitCost: number; reason: "stok_awal" | "penerimaan";
  deliveryNote?: string | null };
export async function receiveFromSupplier(db: pg.ClientBase, key: string, branchId: string | null, r: ReceiveInput) {
  // a non-finite number never reaches runCommand (it refuses it with a raw error); the database bounds the rest
  if (!Number.isFinite(r.unitCost)) throw new SupplierError("ERR_INVALID_INPUT", "unit cost");
  const p: Record<string, Json> = { supplier_id: r.supplierId, item_id: r.itemId, batch_no: r.batchNo, expiry: r.expiry, quantity: qty(r.quantity), reason: r.reason,
    unit_cost: r.unitCost };
  if (r.deliveryNote) p.delivery_note = r.deliveryNote;
  const out = await command<string>(db, "supplier_receive", key, { branch_id: branchId, receipt: p }, `select supplier_receive($1, $2, $3::jsonb) as r`, [key, branchId, JSON.stringify(p)]);
  return { receiptId: out.result, replayed: out.replayed };
}

export type ReturnInput = { supplierId: string; batchId: string; quantity: string; reason: ReturnReason; note: string; depotId?: string | null; creditNoteRef?: string | null };
export async function returnToSupplier(db: pg.ClientBase, key: string, branchId: string | null, r: ReturnInput) {
  const p: Record<string, Json> = { supplier_id: r.supplierId, batch_id: r.batchId, quantity: qty(r.quantity), reason: r.reason, note: r.note };
  if (r.depotId) p.depot_id = r.depotId;
  if (r.creditNoteRef) p.credit_note_ref = r.creditNoteRef;
  const out = await command<string>(db, "supplier_return_record", key, { branch_id: branchId, return: p }, `select supplier_return_record($1, $2, $3::jsonb) as r`,
    [key, branchId, JSON.stringify(p)]);
  return { returnId: out.result, replayed: out.replayed };
}

// ── Readers ─────────────────────────────────────────────────────────────────────────────────────────────
export type Supplier = { id: string; name: string; npwp: string | null; contact_name: string | null; phone: string | null; email: string | null; address: string | null;
  payment_terms_days: number; active: boolean };
export type SupplierReturn = {
  id: string; branch_id: string; supplier_id: string; supplier_name: string; depot_id: string; batch_id: string; batch_no: string; expiry: string; item: string; unit: string;
  quantity: number; reason: ReturnReason; note: string; credit_note_ref: string | null; returned_at: string; returned_as: string;
  // cost readers only
  value?: number; uncosted_qty?: number; expectation?: { id: string; amount: number; uncosted: boolean; state: ExpectationState } | null;
};
export type SupplierDetail = Supplier & {
  receipts: { id: string; branch_id: string; batch_id: string; batch_no: string; expiry: string; item: string; unit: string; quantity: number; delivery_note: string | null;
    received_at: string; unit_cost: number | null }[];
  returns: SupplierReturn[];
};
export type ReturnableBatch = { batch_id: string; batch_no: string; expiry: string; state: string; item: string; unit: string; open: number;
  depots: { depot_id: string; name: string; sealed: number }[] };
const read = async <T>(db: pg.ClientBase, sql: string, args: unknown[]): Promise<T> => (await call(() => db.query(sql, args))).rows[0].r as T;
export const listSuppliers = (db: pg.ClientBase) => read<Supplier[]>(db, `select supplier_list() as r`, []);
export const getSupplier = (db: pg.ClientBase, id: string) => read<SupplierDetail>(db, `select supplier_get($1) as r`, [id]);
export const listReturns = (db: pg.ClientBase, branchId: string | null) => read<SupplierReturn[]>(db, `select supplier_return_list($1) as r`, [branchId]);
export const returnableBatches = (db: pg.ClientBase, supplierId: string, branchId: string | null) =>
  read<ReturnableBatch[]>(db, `select supplier_batches($1, $2) as r`, [supplierId, branchId]);
