// Keluhan Klinis and Layanan (PR-43, CLIN-016, CLIN-024; T-057, UX-28). Every call runs inside withTenantContext;
// the database decides authority (DEC-066: klinis handled by doctor, nurse, pharmacist and facility head, layanan by
// manager and facility head; flaggers outside the handlers see status only), computes the due time from SET-31 and
// the branch hours, and escalates overdue tasks when they are read. Command results hold ids only.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import type { COMPLAINT_CATEGORIES, COMPLAINT_EVENT_KINDS, COMPLAINT_KINDS, COMPLAINT_OUTCOMES, COMPLAINT_SOURCES, COMPLAINT_STATES, COMPLAINT_TRIAGE } from "../schema";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT"]);

export class ComplaintError extends CommandError {
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
    if (m && KNOWN.has(m[1])) throw new ComplaintError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, fn: (c: pg.ClientBase) => Promise<T>) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, fn));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export type ComplaintKind = (typeof COMPLAINT_KINDS)[number];
export type ComplaintSource = (typeof COMPLAINT_SOURCES)[number];
export type Triage = (typeof COMPLAINT_TRIAGE)[number];
export type ServiceCategory = (typeof COMPLAINT_CATEGORIES)[number];
export type ComplaintState = (typeof COMPLAINT_STATES)[number];
export type Outcome = (typeof COMPLAINT_OUTCOMES)[number];
export type ComplaintEventKind = (typeof COMPLAINT_EVENT_KINDS)[number];

// ── Flag (PR-43 visit note, staff flag; CLIN-024 pharmacist) ──────────────────────────────────────
export type FlagInput = {
  patientId: string; kind: ComplaintKind; source: ComplaintSource; summary: string;
  triage?: Triage; category?: ServiceCategory; visitId?: string; branchId?: string;
};
export async function flagComplaint(db: pg.ClientBase, key: string, i: FlagInput) {
  const p: Record<string, Json> = { kind: i.kind, source: i.source, summary: i.summary };
  if (i.triage !== undefined) p.triage = i.triage;
  if (i.category !== undefined) p.category = i.category;
  if (i.visitId !== undefined) p.visit_id = i.visitId;
  if (i.branchId !== undefined) p.branch_id = i.branchId;
  const out = await command<string>(db, "complaint_flag", key, { patient_id: i.patientId, complaint: p }, async (c) =>
    (await c.query(`select complaint_flag($1, $2::jsonb) as r`, [i.patientId, JSON.stringify(p)])).rows[0].r);
  return { taskId: out.result, replayed: out.replayed };
}

// ── Handler actions ──────────────────────────────────────────────────────────────────────────────
async function act(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  const out = await command(db, name, key, body, async (c) => {
    await c.query(sql, args);
    return null;
  });
  return { replayed: out.replayed };
}
export const takeComplaint = (db: pg.ClientBase, key: string, taskId: string) =>
  act(db, "complaint_take", key, { task_id: taskId }, `select complaint_take($1)`, [taskId]);
export const triageComplaint = (db: pg.ClientBase, key: string, taskId: string, triage: Triage) =>
  act(db, "complaint_triage", key, { task_id: taskId, triage }, `select complaint_triage($1, $2)`, [taskId, triage]);
export const noteComplaint = (db: pg.ClientBase, key: string, taskId: string, note: string) =>
  act(db, "complaint_note", key, { task_id: taskId, note }, `select complaint_note($1, $2)`, [taskId, note]);
export const resolveComplaint = (db: pg.ClientBase, key: string, taskId: string, outcome: Outcome, note: string) =>
  act(db, "complaint_resolve", key, { task_id: taskId, outcome, note }, `select complaint_resolve($1, $2, $3)`, [taskId, outcome, note]);
export const reopenComplaint = (db: pg.ClientBase, key: string, taskId: string, note: string) =>
  act(db, "complaint_reopen", key, { task_id: taskId, note }, `select complaint_reopen($1, $2)`, [taskId, note]);

// ── Readers ──────────────────────────────────────────────────────────────────────────────────────
export type ComplaintRow = {
  id: string; branch_id: string; branch_name: string; patient_id: string; patient_name: string; patient_mrn: string;
  visit_id: string | null; kind: ComplaintKind; source: ComplaintSource; triage: Triage | null; category: ServiceCategory | null;
  state: ComplaintState; due_at: string; overdue: boolean; assigned_to: string | null; assigned_to_name: string | null;
  flagged_by: string; flagged_by_name: string; flagged_as: string; created_at: string; resolved_at: string | null; escalated_at: string | null;
  // Only for a handler of the kind (content true).
  content: boolean; summary?: string; resolution_outcome?: Outcome | null; resolution_note?: string | null; resolved_by_name?: string | null;
};
export type ComplaintEvent = {
  id: string; kind: ComplaintEventKind; actor_id: string | null; actor_role: string | null; actor_name: string | null; created_at: string; note?: string | null;
};
export type ComplaintList = { role: string; tasks: ComplaintRow[] };
export type ComplaintDetail = ComplaintRow & { handler: boolean; events: ComplaintEvent[] };
export type FlagOptions = {
  role: string; branch_id: string; branch_name: string;
  visits: { visit_id: string; patient_id: string; patient_name: string; patient_mrn: string; checked_in_at: string }[];
};

export async function listComplaints(db: pg.ClientBase, branchId: string | null, kind: ComplaintKind | null): Promise<ComplaintList> {
  return (await call(() => db.query(`select complaint_list($1, $2) as r`, [branchId, kind]))).rows[0].r as ComplaintList;
}
export async function getComplaint(db: pg.ClientBase, taskId: string): Promise<ComplaintDetail> {
  return (await call(() => db.query(`select complaint_get($1) as r`, [taskId]))).rows[0].r as ComplaintDetail;
}
export async function flagOptions(db: pg.ClientBase, branchId: string | null): Promise<FlagOptions> {
  return (await call(() => db.query(`select complaint_flag_options($1) as r`, [branchId]))).rows[0].r as FlagOptions;
}
