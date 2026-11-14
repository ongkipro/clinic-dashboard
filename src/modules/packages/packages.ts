// Paket (PR-20, BILL-7..11, BILL-16, BILL-24, BILL-25; T-076, migration 0091, DEC-087). Server code over the package
// definers; every call runs inside withTenantContext and the database decides authority, the branch, the unlocking by
// paid value and the money moves. A package is sold on a Kasir invoice (openKasirInvoice with a patient and no visit,
// issueKasirInvoice with its one package line) and paid by ordinary Terima receipts (Bayar Cicilan).
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../lib/command";
import { assertProductionGoLive } from "../vendor/profile/profile";

export class PackageError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set([
  "ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT", "ERR_NOT_AVAILABLE",
  "ERR_SESSION_NOT_UNLOCKED", "ERR_PACKAGE_EXPIRED", "ERR_MIN_DP_NOT_MET", "ERR_BALANCE_INSUFFICIENT", "ERR_APPROVER_IS_REQUESTER",
]);
export async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new PackageError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

// ── Writers ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function setPackageContents(db: pg.ClientBase, key: string, versionId: string, rows: { serviceItemId: string; count: number }[]) {
  const p = { rows: rows.map((r) => ({ service_item_id: r.serviceItemId, count: r.count })) };
  await command(db, "package_contents_set", key, { version_id: versionId, contents: p }, `select package_contents_set($1, $2::jsonb) as r`, [versionId, JSON.stringify(p)]);
}
export async function reserveSession(db: pg.ClientBase, key: string, packageId: string, visitId: string, serviceItemId?: string) {
  const p: Record<string, Json> = serviceItemId ? { service_item_id: serviceItemId } : {};
  const out = await command<{ session_id: string }>(db, "package_reserve", key, { package_id: packageId, visit_id: visitId, reserve: p },
    `select package_reserve($1, $2, $3, $4::jsonb) as r`, [key, packageId, visitId, JSON.stringify(p)]);
  return { sessionId: out.result.session_id, replayed: out.replayed };
}
export async function releaseSession(db: pg.ClientBase, key: string, sessionId: string) {
  await command(db, "package_release", key, { session_id: sessionId }, `select package_release($1) as r`, [sessionId]);
}
export async function cancelPackage(db: pg.ClientBase, key: string, packageId: string, reason: string) {
  const out = await command<{ package_id: string; state: string; to_balance: number; cancelled: number }>(db, "package_cancel", key,
    { package_id: packageId, reason }, `select package_cancel($1, $2) as r`, [packageId, reason]);
  return out.result;
}
export async function interruptedToBalance(db: pg.ClientBase, key: string, executionId: string) {
  const out = await command<{ entry_id: string; amount: number }>(db, "interrupted_to_balance", key, { execution_id: executionId },
    `select interrupted_to_balance($1, $2) as r`, [key, executionId]);
  return out.result;
}
export async function requestSubstitution(db: pg.ClientBase, key: string, sessionId: string, serviceItemId: string, reason: string) {
  const p = { service_item_id: serviceItemId, reason };
  const out = await command<string>(db, "package_substitution_request", key, { session_id: sessionId, substitution: p },
    `select package_substitution_request($1, $2, $3::jsonb) as r`, [key, sessionId, JSON.stringify(p)]);
  return { substitutionId: out.result };
}
export async function decideSubstitution(db: pg.ClientBase, key: string, substitutionId: string, approve: boolean, reason: string | null) {
  const out = await command<{ state: string; difference?: number }>(db, "package_substitution_decide", key, { substitution_id: substitutionId, approve, reason },
    `select package_substitution_decide($1, $2, $3) as r`, [substitutionId, approve, reason]);
  return out.result;
}
export type TopUp = { method: "cash" | "edc" | "transfer"; amount: number; cashTendered?: number; details?: Record<string, string> };
export async function topUpBalance(db: pg.ClientBase, key: string, patientId: string, branchId: string | null, t: TopUp) {
  const p: Record<string, Json> = { method: t.method, amount: t.amount };
  if (t.cashTendered !== undefined) p.cash_tendered = t.cashTendered;
  if (t.details) p.details = t.details;
  const out = await command<{ receipt_id: string; number: string; top_up_id: string; change: number }>(db, "balance_top_up", key,
    { patient_id: patientId, branch_id: branchId, top_up: p }, `select balance_top_up($1, $2, $3, $4::jsonb) as r`, [key, patientId, branchId, JSON.stringify(p)]);
  return out.result;
}

// ── Readers ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type SessionRow = {
  id: string; seq: number; service_item_id: string; service: string | null; value: number; state: "available" | "reserved" | "redeemed" | "closed";
  visit_id: string | null; redeemed_at: string | null; redeemed_branch: string | null; pending_substitution: boolean;
  patient: { id: string; name: string | null; mrn: string } | null; // T-082: the treated patient (owner or beneficiary)
};
export type PackageRow = {
  id: string; name: string; price: number; paid: number; min_dp: number; state: "active" | "expired" | "cancelled"; validity_end: string;
  invoice_id: string; invoice_number: string | null; outstanding: number; sold_branch: { id: string; name: string };
  redeemed: number; reserved: number; unlocked_value: number; next_need: number | null; paid_unused_moved: number | null; remainder_cancelled: number | null;
  sessions: SessionRow[];
  // T-082 (PR-93): the sharing snapshot, the active beneficiaries and whether the role may add one.
  sharing_allowed: boolean; can_share: boolean;
  beneficiaries: { id: string; patient: { id: string; name: string | null; mrn: string }; granted_at: string }[];
};
// A package shared with the patient (a beneficiary projection: no billing fields, no other beneficiaries).
export type SharedPackageRow = {
  id: string; name: string; state: "active"; validity_end: string; sold_branch: { id: string; name: string };
  shared_from: { id: string; name: string | null; mrn: string }; redeemed: number; reserved: number; unlocked_value: number; next_need: number | null;
  can_reserve: boolean; can_cancel: false; can_share: false;
  sessions: { id: string; seq: number; service_item_id: string; service: string | null; state: SessionRow["state"]; visit_id: string | null; mine: boolean }[];
};
export type PatientPackages = {
  patient: { id: string; name: string | null; mrn: string } | null; role: string; can_reserve: boolean; can_cancel: boolean; can_top_up: boolean;
  balance: number; packages: PackageRow[]; shared_packages: SharedPackageRow[]; visits: { id: string; checked_in_at: string }[];
};
export const patientPackages = (db: pg.ClientBase, patientId: string) =>
  call(async () => (await db.query(`select package_patient_get($1) as r`, [patientId])).rows[0].r as PatientPackages);
export type PatientHit = { id: string; name: string | null; mrn: string; balance: number; active_packages: number };
export const searchPatients = (db: pg.ClientBase, query: string) =>
  call(async () => (await db.query(`select package_patient_search($1) as r`, [query])).rows[0].r as PatientHit[]);
export type PackageContents = { version_id: string; sold: boolean; can_edit: boolean; rows: { seq: number; service_item_id: string; service: string | null; count: number }[] };
export const packageContents = (db: pg.ClientBase, versionId: string) =>
  call(async () => (await db.query(`select package_contents_get($1) as r`, [versionId])).rows[0].r as PackageContents);
