// Permintaan Klinis (PR-45, UX-27; T-056, DEC-068). Every call runs inside withTenantContext; the database decides
// authority (proposers: BC, doctor, nurse, therapist of the visit's branch; deciders: a doctor or facility head of
// the branch, never the requester), applies an approved change to the plan, reopens the consent step when the plan
// outgrows its consent, and alerts FO (ids only). Command results hold ids and codes only. No money (M4).
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import type { DOSE_UNITS, REQUEST_KINDS, REQUEST_STATES } from "../schema";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT",
  "ERR_APPROVER_IS_REQUESTER"]);

export class RequestError extends CommandError {
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
    if (m && KNOWN.has(m[1])) throw new RequestError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export type RequestKind = (typeof REQUEST_KINDS)[number];
export type RequestState = (typeof REQUEST_STATES)[number];
export type DoseUnit = (typeof DOSE_UNITS)[number];

export type NewRequest = {
  kind: RequestKind; planId: string; catalogVersionId: string; stage: number; qty: number; reason: string;
  targetItemId?: string; doseMicro?: number; doseUnit?: DoseUnit;
};
export async function createRequest(db: pg.ClientBase, key: string, visitId: string, r: NewRequest) {
  const p: Record<string, Json> = { kind: r.kind, plan_id: r.planId, catalog_version_id: r.catalogVersionId, stage: r.stage, qty: r.qty, reason: r.reason };
  if (r.targetItemId !== undefined) p.target_item_id = r.targetItemId;
  if (r.doseMicro !== undefined) p.dose_micro = r.doseMicro;
  if (r.doseUnit !== undefined) p.dose_unit = r.doseUnit;
  const out = await command<string>(db, "clinical_request_create", key, { visit_id: visitId, request: p },
    `select clinical_request_create($1, $2::jsonb) as r`, [visitId, JSON.stringify(p)]);
  return { requestId: out.result, replayed: out.replayed };
}
export type Decision = { state: "approved"; item_id: string; consent: "active" | "outdated" | "none" } | { state: "declined" };
export async function decideRequest(db: pg.ClientBase, key: string, requestId: string, approve: boolean, reason: string | null) {
  const out = await command<Decision>(db, "clinical_request_decide", key, { request_id: requestId, approve, reason },
    `select clinical_request_decide($1, $2, $3) as r`, [requestId, approve, reason]);
  return { ...out.result, replayed: out.replayed };
}
export async function cancelRequest(db: pg.ClientBase, key: string, requestId: string) {
  const out = await command(db, "clinical_request_cancel", key, { request_id: requestId }, `select clinical_request_cancel($1) as r`, [requestId]);
  return { replayed: out.replayed };
}

export type RequestRow = {
  id: string; visit_id: string; plan_id: string; kind: RequestKind; state: RequestState; patient_id: string; patient_name: string; patient_mrn: string;
  plan_title: string; item_name: string; target_name: string | null; target_qty: number | null; stage: number; qty: number; price_impact: number;
  requested_by: string; requested_as: string; requested_at: string; requester_name: string; decided_as: string | null; decided_at: string | null;
  decider_name: string | null; visit_open: boolean; consent: "active" | "outdated" | "none" | null; can_decide: boolean; can_cancel: boolean; full: boolean;
  // Clinical readers only (full).
  reason?: string; decision_reason?: string | null; dose_micro?: number | null; dose_unit?: DoseUnit | null;
  target_dose_micro?: number | null; target_dose_unit?: DoseUnit | null; plan_condition?: string;
};
export type RequestOptions = {
  role: string; branch_name: string;
  visits: { visit_id: string; patient_name: string; patient_mrn: string; checked_in_at: string;
    plans: { plan_id: string; title: string; condition?: string;
      items: { item_id: string; stage: number; qty: number; catalog_version_id: string; name: string; dose_micro?: number | null; dose_unit?: DoseUnit | null }[] }[] }[];
  catalog: { catalog_version_id: string; name: string; kind: string }[];
};
export async function listRequests(db: pg.ClientBase, state: "pending" | "decided" | null): Promise<{ role: string; requests: RequestRow[] }> {
  return (await call(() => db.query(`select clinical_request_list($1) as r`, [state]))).rows[0].r;
}
export async function getRequest(db: pg.ClientBase, requestId: string): Promise<RequestRow> {
  return (await call(() => db.query(`select clinical_request_get($1) as r`, [requestId]))).rows[0].r;
}
export async function requestOptions(db: pg.ClientBase, visitId: string | null): Promise<RequestOptions> {
  return (await call(() => db.query(`select clinical_request_options($1) as r`, [visitId]))).rows[0].r;
}
