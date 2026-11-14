// Consultation fee and free controls (PR-12, BILL-4, BILL-5, BILL-21, B-02; T-079, migration 0095, DEC-092). Server code over
// the consultation definers; every call runs inside withTenantContext and the database decides authority, the branch, the fee
// and the money moves. The fee (SET-6) is charged on a consultation visit with no qualifying purchase, waived with one (frozen
// at close, no retroactive waiver), by a package session, a valid free control or a kontrol_gratis complaint, and re-charged
// from the refund that takes the last qualifying purchase (paid from the balance before any cash leaves). The rule is inactive
// while SET-6 is unset. The visit's close decides the fee (visit_close); this module charges, exempts and schedules controls.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";

export class ConsultationError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set([
  "ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT", "ERR_NOT_AVAILABLE",
  "ERR_GATE_CLOSED",
]);
export async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new ConsultationError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export type FeeCharged = { invoice_id: string; number: string; invoice_line_id: string; amount: number };
// Tagih Konsultasi (4a): the visit's consultation invoice at SET-6; paid by an ordinary Terima.
export async function chargeConsultationFee(db: pg.ClientBase, key: string, visitId: string, itemId?: string) {
  const p: Record<string, Json> = itemId ? { item_id: itemId } : {};
  const out = await command<FeeCharged>(db, "consultation_fee_charge", key, { visit_id: visitId, fee: p },
    `select consultation_fee_charge($1, $2, $3::jsonb) as r`, [key, visitId, JSON.stringify(p)]);
  return { ...out.result, replayed: out.replayed };
}

export type Exemption = { waiver: "control"; controlId: string } | { waiver: "complaint"; complaintTaskId: string };
// Konsultasi Gratis: a valid free control (BILL-5) or a kontrol_gratis complaint (PR-43) waives the fee before close.
export async function exemptConsultationFee(db: pg.ClientBase, key: string, visitId: string, x: Exemption) {
  const p: Record<string, Json> = x.waiver === "control" ? { waiver: "control", control_id: x.controlId } : { waiver: "complaint", complaint_task_id: x.complaintTaskId };
  const out = await command<{ fee_id: string }>(db, "consultation_fee_exempt", key, { visit_id: visitId, exemption: p },
    `select consultation_fee_exempt($1, $2, $3::jsonb) as r`, [key, visitId, JSON.stringify(p)]);
  return { ...out.result, replayed: out.replayed };
}

// Jadwalkan Kontrol (BILL-5): a free control of a purchased line on a branch-local date (YYYY-MM-DD).
export async function scheduleControl(db: pg.ClientBase, key: string, invoiceLineId: string, controlDate: string) {
  const p = { control_date: controlDate };
  const out = await command<{ control_id: string; control_date: string; valid_until: string }>(db, "control_schedule", key,
    { invoice_line_id: invoiceLineId, control: p }, `select control_schedule($1, $2, $3::jsonb) as r`, [key, invoiceLineId, JSON.stringify(p)]);
  return { ...out.result, replayed: out.replayed };
}

// ── Readers ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export type ConsultationFee = {
  visit_id: string; status: "due" | "charged" | "waived" | "recharged" | "none"; waiver: "purchase" | "package_session" | "control" | "complaint" | null;
  amount: number | null; deducted: number | null; invoice_id: string | null; control_id: string | null;
};
export const getConsultationFee = (db: pg.ClientBase, visitId: string) =>
  call(async () => (await db.query(`select consultation_fee_get($1) as r`, [visitId])).rows[0].r as ConsultationFee);

export type Control = {
  id: string; invoice_line_id: string; item: string; seq: number; control_date: string; valid_until: string; state: "scheduled" | "used" | "cancelled";
  used_visit_id: string | null; branch_id: string;
};
export const listControls = (db: pg.ClientBase, patientId: string) =>
  call(async () => (await db.query(`select control_list($1) as r`, [patientId])).rows[0].r as { patient_id: string; controls: Control[] });
