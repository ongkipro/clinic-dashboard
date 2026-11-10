// Lembar Pemeriksaan (PR-10, CLIN-004, CLIN-012; T-052). Every call runs inside withTenantContext; the
// database decides who may (a doctor of the visit's branch opens; only the author edits a draft), what is
// valid and what is visible (clinical readers vs the plan projection for BC / FO / nurse / therapist).
// Writers go through runCommand with the caller's idempotency key and the production go-live gate. Readers
// return the database JSON as is (snake_case, ISO dates); money is integer rupiah, doses integer micro-units.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import type { DOSE_UNITS, FACT_KINDS, MAP_LAYERS, MAP_TEMPLATES, PLAN_STATES, VERIFY_DECISIONS } from "../schema";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED"]);

export class ExamError extends CommandError {
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
    if (m && KNOWN.has(m[1])) throw new ExamError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}
async function read<T>(db: pg.ClientBase, sql: string, args: unknown[]): Promise<T> {
  return (await call(() => db.query(sql, args))).rows[0].r as T;
}

export type Decision = (typeof VERIFY_DECISIONS)[number];
export type MapTemplate = (typeof MAP_TEMPLATES)[number];
export type MapLayer = (typeof MAP_LAYERS)[number];
export type DoseUnit = (typeof DOSE_UNITS)[number];
export type PlanState = (typeof PLAN_STATES)[number];

// ── Writers ──────────────────────────────────────────────────────────────────────────────────────
export async function openExam(db: pg.ClientBase, key: string, visitId: string) {
  const out = await command<string>(db, "exam_open", key, { visit_id: visitId }, `select exam_open($1) as r`, [visitId]);
  return { examId: out.result, replayed: out.replayed };
}

// Absent keys stay unchanged; the database refuses unknown keys, bad templates, vitals and codes.
export type ExamPayload = {
  subjective?: string | null; objective?: string | null; assessment?: string | null; plan_note?: string | null;
  template_key?: string | null; template_values?: Record<string, string>; vitals?: Record<string, number>; icd10_codes?: string[];
};
export async function saveExam(db: pg.ClientBase, key: string, examId: string, payload: ExamPayload | Record<string, unknown>) {
  const out = await command(db, "exam_save", key, { examination_id: examId, payload: payload as Json }, `select exam_save($1, $2::jsonb) as r`, [examId, JSON.stringify(payload)]);
  return { replayed: out.replayed };
}

// CLIN-004: returns the verification's version (1, then +1 per changed re-decision while a draft).
export async function verifyFact(db: pg.ClientBase, key: string, examId: string, factId: string, decision: Decision, value: string | null = null) {
  const out = await command<number>(db, "intake_verify", key, { examination_id: examId, fact_id: factId, decision, value },
    `select intake_verify($1, $2, $3, $4) as r`, [examId, factId, decision, value]);
  return { version: out.result, replayed: out.replayed };
}

export type MarkInput = {
  template: MapTemplate; layer: MapLayer; x: number; y: number; label: string;
  catalog_version_id?: string; dose_micro?: number; dose_unit?: DoseUnit;
};
export async function setMark(db: pg.ClientBase, key: string, examId: string, mark: MarkInput) {
  const out = await command<string>(db, "mark_set", key, { examination_id: examId, mark: mark as unknown as Json }, `select mark_set($1, $2::jsonb) as r`, [examId, JSON.stringify(mark)]);
  return { markId: out.result, replayed: out.replayed };
}
export async function removeMark(db: pg.ClientBase, key: string, examId: string, markId: string) {
  const out = await command(db, "mark_remove", key, { examination_id: examId, mark_id: markId }, `select mark_remove($1, $2) as r`, [examId, markId]);
  return { replayed: out.replayed };
}

export async function createPlan(db: pg.ClientBase, key: string, examId: string, title: string, condition: string) {
  const out = await command<string>(db, "plan_create", key, { examination_id: examId, title, condition }, `select plan_create($1, $2, $3) as r`, [examId, title, condition]);
  return { planId: out.result, replayed: out.replayed };
}
export type PlanItemInput = { stage: number; catalog_version_id: string; qty: number; dose_micro?: number; dose_unit?: DoseUnit; note?: string };
export async function addPlanItem(db: pg.ClientBase, key: string, examId: string, planId: string, item: PlanItemInput) {
  const out = await command<string>(db, "plan_item_add", key, { examination_id: examId, plan_id: planId, item: item as unknown as Json },
    `select plan_item_add($1, $2, $3::jsonb) as r`, [examId, planId, JSON.stringify(item)]);
  return { itemId: out.result, replayed: out.replayed };
}
export async function removePlanItem(db: pg.ClientBase, key: string, examId: string, itemId: string) {
  const out = await command(db, "plan_item_remove", key, { examination_id: examId, item_id: itemId }, `select plan_item_remove($1, $2) as r`, [examId, itemId]);
  return { replayed: out.replayed };
}
export async function closePlan(db: pg.ClientBase, key: string, examId: string, planId: string, state: "completed" | "stopped") {
  const out = await command(db, "plan_close", key, { examination_id: examId, plan_id: planId, state }, `select plan_close($1, $2, $3) as r`, [examId, planId, state]);
  return { replayed: out.replayed };
}

// ── Readers ──────────────────────────────────────────────────────────────────────────────────────
export type QueueVisit = {
  id: string; kind: string; checked_in_at: string; patient_id: string; patient_name: string; patient_mrn: string;
  intake: string; doctor: string; closed: boolean; intake_state: "draft" | "sent" | null;
  exam_id: string | null; exam_state: "draft" | null; author_id: string | null; author_name: string | null; cautions: number;
};
export type Queue = { today: string; branch_name: string; visits: QueueVisit[] };
export const examQueue = (db: pg.ClientBase, branchId: string) => read<Queue>(db, `select pemeriksaan_visits($1) as r`, [branchId]);

export type Caution = { fact_id: string; kind: "allergy"; value: string; provenance: "bc_captured_unverified" | "clinician_verified"; sent_at: string; verified_at?: string; decision?: Decision };
export type SheetFact = {
  id: string; kind: (typeof FACT_KINDS)[number]; value: string; provenance: string; prior: boolean;
  verification: null | { decision: Decision; corrected_value: string | null; version: number; verified_at: string; provenance: "clinician_verified" };
};
export type Mark = { id: string; template: MapTemplate; layer: MapLayer; x: number; y: number; label: string; catalog_version_id?: string; dose_micro?: number; dose_unit?: DoseUnit };
export type PlanItem = {
  id: string; stage: number; item_id: string; version_id: string; name: string; kind: string; qty: number; unit_price: number | null; line_total: number | null;
  dose_micro?: number; dose_unit?: DoseUnit; note?: string; examination_id?: string;
};
export type Plan = { id: string; title: string; state: PlanState; created_at: string; condition?: string; created_exam_id?: string; items: PlanItem[] };
export type Sheet = {
  visit: { id: string; branch_id: string; checked_in_at: string; closed: boolean; intake: string; doctor: string };
  patient: { id: string; name: string; mrn: string; birth_date: string | null; sex: string };
  cautions: Caution[];
  intake: null | {
    id: string; state: "draft" | "sent"; complaint: string | null; sent_at: string | null; author_id: string; author_name: string;
    observation: { chips: string[]; note: string | null } | null; facts: SheetFact[];
  };
  examination: null | {
    id: string; state: "draft"; author_id: string; author_name: string; subjective: string | null; objective: string | null; assessment: string | null;
    plan_note: string | null; template_key: string | null; template_values: Record<string, string>; vitals: Record<string, number>; icd10_codes: string[];
    updated_at: string; marks: Mark[];
  };
  earlier: { visit_id: string; checked_in_at: string; branch_name: string; complaint: string | null; assessment: string | null; icd10_codes: string[] | null; author_name: string | null }[];
  plans: Plan[];
};
// The doctor's sheet of a visit (one read; audited as a clinical read).
export const examSheet = (db: pg.ClientBase, visitId: string) => read<Sheet>(db, `select exam_sheet($1) as r`, [visitId]);

// The plan projection for BC / FO / doctor / nurse / therapist: titles, items and live prices only.
export type PlanOptions = { visit_id: string; plans: Plan[] };
export const planOptions = (db: pg.ClientBase, visitId: string) => read<PlanOptions>(db, `select plan_options($1) as r`, [visitId]);
