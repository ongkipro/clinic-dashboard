// Siapkan & Serahkan (PR-18, UX-10, DATA-20, DATA-26; T-065, DEC-075). Every call runs inside withTenantContext; the
// database decides authority (pharmacist writes at the active branch; the doctor's prescription; BC / doctor / front
// office confirm the selection). Commands go through runCommand with the caller's key (production needs the go-live
// gate first); database errors are mapped outside it (a refusal rolls the attempt back whole). Results hold ids and
// codes only.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../lib/command";
import type { StepUp } from "../clinical/records/records";
import { assertProductionGoLive } from "../vendor/profile/profile";
import type { DISPENSING_STATES, LABEL_KINDS, PHARMACIST_CHECKS, PRESCRIPTION_STATES } from "./schema";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT",
  "ERR_STOCK_UNFIT", "ERR_STOCK_INSUFFICIENT"]);

export class PharmacyError extends CommandError {
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
    if (m && KNOWN.has(m[1])) throw new PharmacyError(m[1] as ErrorCode, m[2]);
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
  if (!QTY.test(q)) throw new PharmacyError("ERR_INVALID_INPUT", "quantity");
  return q;
};

export type PrescriptionState = (typeof PRESCRIPTION_STATES)[number];
export type DispensingState = (typeof DISPENSING_STATES)[number];
export type LabelKind = (typeof LABEL_KINDS)[number];
export type Check = (typeof PHARMACIST_CHECKS)[number];
export const CHECKS: readonly Check[] = ["identity", "validity", "dose", "allergy", "clarification", "label", "counselling"];

// ── Selection (DATA-20 subset) ─────────────────────────────────────────────────────────────────────────
export type SelectionItem = { planItemId: string; quantity?: string } | { catalogVersionId: string; quantity: string };
export async function confirmSelection(db: pg.ClientBase, key: string, visitId: string, s: { items: SelectionItem[]; guidingBcId?: string | null; closingBcId?: string | null }) {
  const items: Json[] = s.items.map((i): Json => {
    if (!("planItemId" in i)) return { catalog_version_id: i.catalogVersionId, quantity: qty(i.quantity) };
    const x: Record<string, Json> = { plan_item_id: i.planItemId };
    if (i.quantity !== undefined) x.quantity = qty(i.quantity);
    return x;
  });
  const p: Record<string, Json> = { items };
  if (s.guidingBcId) p.guiding_bc_id = s.guidingBcId;
  if (s.closingBcId) p.closing_bc_id = s.closingBcId;
  const out = await command<string>(db, "selection_confirm", key, { visit_id: visitId, selection: p }, `select selection_confirm($1, $2, $3::jsonb) as r`, [key, visitId, JSON.stringify(p)]);
  return { selectionId: out.result, replayed: out.replayed };
}

// ── Recipe map and special list (pharmacist) ───────────────────────────────────────────────────────────
export async function mapRecipe(db: pg.ClientBase, key: string, versionId: string, row: number, m: { stockItemId: string; quantity: string }) {
  const p = { stock_item_id: m.stockItemId, quantity: qty(m.quantity) };
  const out = await command<string>(db, "recipe_map_set", key, { catalog_version_id: versionId, row, mapping: p }, `select recipe_map_set($1, $2, $3::jsonb) as r`, [versionId, row, JSON.stringify(p)]);
  return { mappingId: out.result, replayed: out.replayed };
}
export async function addSpecialItem(db: pg.ClientBase, key: string, catalogItemId: string, reason: string) {
  const out = await command<string>(db, "special_item_add", key, { catalog_item_id: catalogItemId, reason }, `select special_item_add($1, $2) as r`, [catalogItemId, reason]);
  return { id: out.result, replayed: out.replayed };
}

// ── Siapkan ────────────────────────────────────────────────────────────────────────────────────────────
/** A selected treatment's mapped recipe → a T-062 material request (the pharmacist then issues it with issueMaterials). */
export async function prepareMaterials(db: pg.ClientBase, key: string, selectionItemId: string, roomDepotId: string | null = null) {
  const out = await command<string>(db, "selection_prepare_materials", key, { selection_item_id: selectionItemId, room_depot_id: roomDepotId },
    `select selection_prepare_materials($1, $2, $3) as r`, [key, selectionItemId, roomDepotId]);
  return { requestId: out.result, replayed: out.replayed };
}
/** A product dispensing: depot chosen, FEFO coverable; no stock moves (CLIN-017). */
export async function prepareDispensing(db: pg.ClientBase, key: string, dispensingId: string, depotId: string | null = null) {
  const out = await command(db, "dispense_prepare", key, { dispensing_id: dispensingId, depot_id: depotId }, `select dispense_prepare($1, $2, $3) as r`, [key, dispensingId, depotId]);
  return { replayed: out.replayed };
}

// ── Serahkan ───────────────────────────────────────────────────────────────────────────────────────────
export type HandOver = { checks: Record<Check, boolean>; exceptionNote?: string | null; batches?: { batchId: string; quantity: string }[] };
export async function handOver(db: pg.ClientBase, key: string, dispensingId: string, h: HandOver) {
  const p: Record<string, Json> = { checks: Object.fromEntries(CHECKS.map((c) => [c, h.checks[c] === true])) };
  if (h.exceptionNote) p.exception_note = h.exceptionNote;
  if (h.batches) p.batches = h.batches.map((b) => ({ batch_id: b.batchId, quantity: qty(b.quantity) }));
  const out = await command(db, "dispense_hand_over", key, { dispensing_id: dispensingId, handover: p }, `select dispense_hand_over($1, $2, $3::jsonb) as r`, [key, dispensingId, JSON.stringify(p)]);
  return { replayed: out.replayed };
}
export async function cancelDispensing(db: pg.ClientBase, key: string, dispensingId: string, reason: string) {
  const out = await command(db, "dispense_cancel", key, { dispensing_id: dispensingId, reason }, `select dispense_cancel($1, $2) as r`, [dispensingId, reason]);
  return { replayed: out.replayed };
}
export async function printLabel(db: pg.ClientBase, key: string, dispensingId: string) {
  const out = await command<string>(db, "label_print", key, { dispensing_id: dispensingId }, `select label_print($1) as r`, [dispensingId]);
  return { kind: out.result as LabelKind, replayed: out.replayed };
}

// ── Prescription (doctor; the UX-8 Resep panel is an open UI item) ─────────────────────────────────────
export async function createPrescription(db: pg.ClientBase, key: string, visitId: string, o: { isAcute?: boolean } = {}) {
  const p: Record<string, Json> = o.isAcute !== undefined ? { is_acute: o.isAcute } : {};
  const out = await command<string>(db, "prescription_create", key, { visit_id: visitId, prescription: p }, `select prescription_create($1, $2, $3::jsonb) as r`, [key, visitId, JSON.stringify(p)]);
  return { prescriptionId: out.result, replayed: out.replayed };
}
export type RxItem = { catalogVersionId: string; quantity: string; signa: string; kfaCode?: string | null; externalUse?: boolean };
export async function addPrescriptionItem(db: pg.ClientBase, key: string, prescriptionId: string, i: RxItem) {
  const p: Record<string, Json> = { catalog_version_id: i.catalogVersionId, quantity: qty(i.quantity), signa: i.signa };
  if (i.kfaCode) p.kfa_code = i.kfaCode;
  if (i.externalUse !== undefined) p.external_use = i.externalUse;
  const out = await command<string>(db, "prescription_item_add", key, { prescription_id: prescriptionId, item: p }, `select prescription_item_add($1, $2, $3::jsonb) as r`, [key, prescriptionId, JSON.stringify(p)]);
  return { itemId: out.result, replayed: out.replayed };
}
export async function removePrescriptionItem(db: pg.ClientBase, key: string, prescriptionId: string, itemId: string) {
  const out = await command(db, "prescription_item_remove", key, { prescription_id: prescriptionId, item_id: itemId }, `select prescription_item_remove($1, $2) as r`, [prescriptionId, itemId]);
  return { replayed: out.replayed };
}
export async function signPrescription(db: pg.ClientBase, key: string, prescriptionId: string, stepUp: StepUp) {
  if (stepUp?.verified !== true) throw new PharmacyError("ERR_FORBIDDEN", "step_up_required");
  const out = await command(db, "prescription_sign", key, { prescription_id: prescriptionId }, `select prescription_sign($1) as r`, [prescriptionId]);
  return { replayed: out.replayed };
}

// ── Readers ─────────────────────────────────────────────────────────────────────────────────────────────
export type Blocker = "prescription_unsigned" | "prescription_expired" | "payment_unpaid" | "special_item" | "stock_unavailable"
  | "no_recipe" | "recipe_unmapped" | "room_depot_missing";
export type PatientRef = { visit_id: string; patient_id: string; name: string; mrn: string; checked_in_at: string; payment: string };
export type ItemRef = { stock_item_id: string; name: string; code: string; unit: string };
export type BatchPick = { batch_id: string; batch_no: string; expiry: string; quantity: number };
export type DispensingRow = {
  id: string; state: DispensingState; source: "prescription" | "selection"; patient: PatientRef; item: ItemRef; quantity: number; external_use: boolean;
  queued_at: string; prepared_at: string | null; handed_at: string | null; depot: { id: string; name: string; kind: string } | null;
  suggestion: BatchPick[] | null; blocker: Blocker | null; label: { kind: LabelKind; print_count: number; last_printed_at: string } | null;
};
export type TreatmentPrep = {
  selection_item_id: string; patient: PatientRef; name: string; catalog_version_id: string; quantity: number;
  room_depot: { id: string; name: string } | null; request: { id: string; state: string } | null;
  lines: { row_index: number; material: string; recipe_qty: number; recipe_unit: string; item: ItemRef | null; quantity: number | null }[];
  blocker: Blocker | null;
};
export type PrepList = {
  now: string; branch_name: string; treatments: TreatmentPrep[]; products: DispensingRow[];
  unsigned: { prescription_id: string; patient: PatientRef; prescriber: string; items: number; blocker: "prescription_unsigned" }[];
  stock_items: ItemRef[]; depots: { id: string; name: string; kind: string }[];
};
export type HandoverList = { now: string; branch_name: string; prepared: DispensingRow[]; handed_today: DispensingRow[] };
export type DispensingDetail = DispensingRow & {
  birth_date: string; cautions: { fact_id: string; value: string; provenance: string }[];
  prescription: { id: string; state: PrescriptionState; is_acute: boolean; signed_at: string | null; valid_until: string | null; prescriber: string; signa: string; kfa_code: string | null } | null;
  checks: Record<Check, boolean> | null; exception_note: string | null; cancel_reason: string | null; handed_by: string | null; batches: BatchPick[];
};
export type Prescription = {
  id: string; state: PrescriptionState; is_acute: boolean; created_at: string; signed_at: string | null; valid_until: string | null; patient: PatientRef; prescriber: string;
  items: { id: string; item: ItemRef; signa: string; kfa_code: string | null; quantity: number; external_use: boolean; dispensing: { id: string; state: DispensingState } | null }[];
};
export type RecallTrace = {
  batch_id: string; batch_no: string; expiry: string; state: string; item: ItemRef;
  dispensed: { dispensing_id: string; patient: PatientRef; quantity: number; handed_at: string }[];
  holds: { from: string; to: string; reason: string; at: string }[];
};
const read = async <T>(db: pg.ClientBase, sql: string, args: unknown[]): Promise<T> => (await call(() => db.query(sql, args))).rows[0].r as T;
export const prepList = (db: pg.ClientBase) => read<PrepList>(db, `select pharmacy_prep_list() as r`, []);
export const handoverList = (db: pg.ClientBase) => read<HandoverList>(db, `select pharmacy_handover_list() as r`, []);
export const getDispensing = (db: pg.ClientBase, id: string) => read<DispensingDetail>(db, `select pharmacy_dispensing_get($1) as r`, [id]);
export const getPrescription = (db: pg.ClientBase, id: string) => read<Prescription>(db, `select prescription_get($1) as r`, [id]);
export const recallTrace = (db: pg.ClientBase, batchId: string) => read<RecallTrace>(db, `select pharmacy_recall_trace($1) as r`, [batchId]);
